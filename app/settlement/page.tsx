'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';
import { PREV_MONTH_BILLING_SENTINEL } from '@/utils/dateCalc';
import toast from 'react-hot-toast';

interface CardWithDetails {
  id: string;
  name: string;
  card_details: {
    card_type: 'CREDIT' | 'CHECK';
    settlement_day: number;
    billing_start_offset: number;
    billing_end_offset: number;
    linked_asset_id: string | null;
    linked_asset: { name: string } | null;
  } | null;
}

interface Transaction {
  id: number;
  type: 'EXPENSE' | 'INCOME';
  transacted_at: string;
  description: string | null;
  amount: number;
  categories: { name: string } | null;
}

interface BillingPeriod {
  start: Date;
  end: Date;
  settlementDate: Date;
}

interface CardStatus {
  card: CardWithDetails;
  billingPeriod: BillingPeriod | null;
  billedTotal: number;
  settledAmount: number | null;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function clampToMonthEnd(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

function getBillingPeriod(year: number, month: number, card: CardWithDetails): BillingPeriod | null {
  const cd = card.card_details;
  if (!cd) return null;
  const settlementDate = clampToMonthEnd(year, month - 1, cd.settlement_day);

  if (cd.billing_start_offset === PREV_MONTH_BILLING_SENTINEL) {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    return {
      start: new Date(prevYear, prevMonth - 1, 1),
      end: new Date(prevYear, prevMonth, 0),
      settlementDate,
    };
  }

  return {
    start: addDays(settlementDate, cd.billing_start_offset),
    end: addDays(settlementDate, cd.billing_end_offset),
    settlementDate,
  };
}

function fmtDate(d: Date) {
  const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}(${DAY_KR[d.getDay()]})`;
}

function toDateStr(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`;
}

const toLocalStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function SettlementPage() {
  const router = useRouter();
  const { currentUser, group } = useGroup();
  const detailRef = useRef<HTMLDivElement>(null);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [cards, setCards] = useState<CardWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  // 대시보드 상태
  const [cardStatuses, setCardStatuses] = useState<CardStatus[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);

  // 상세 (선택 카드)
  const [selectedCardId, setSelectedCardId] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [alreadySettled, setAlreadySettled] = useState(false);
  const [settledAmount, setSettledAmount] = useState<number | null>(null);
  const [loadingTx, setLoadingTx] = useState(false);
  const [settling, setSettling] = useState(false);

  // 카드 목록 로드
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.push('/login'); return; }

      const { data } = await supabase
        .from('assets')
        .select(`
          id, name,
          card_details!card_details_asset_id_fkey(
            card_type, settlement_day, billing_start_offset, billing_end_offset,
            linked_asset_id,
            linked_asset:assets!card_details_linked_asset_id_fkey(name)
          )
        `)
        .eq('type', 'CARD')
        .eq('is_active', true)
        .order('name');

      if (data) {
        const credits = (data as unknown as CardWithDetails[]).filter(
          (c) => c.card_details?.card_type === 'CREDIT'
        );
        setCards(credits);
      }
      setLoading(false);
    };
    init();
  }, []);

  // 전체 카드 정산 현황 조회
  const fetchAllCardStatuses = useCallback(async () => {
    if (cards.length === 0) return;
    setStatusLoading(true);
    try {
      const statuses: CardStatus[] = await Promise.all(
        cards.map(async (card) => {
          const period = getBillingPeriod(year, month, card);
          if (!period) return { card, billingPeriod: null, billedTotal: 0, settledAmount: null };

          const periodStart = `${toLocalStr(period.start)}T00:00:00+09:00`;
          const periodEnd   = `${toLocalStr(period.end)}T23:59:59+09:00`;

          const [txRes, settledRes] = await Promise.all([
            supabase
              .from('transactions')
              .select('type, amount')
              .eq('asset_id', card.id)
              .in('type', ['EXPENSE', 'INCOME'])
              .eq('is_deleted', false)
              .gte('transacted_at', periodStart)
              .lte('transacted_at', periodEnd),
            supabase
              .from('transactions')
              .select('amount')
              .eq('is_deleted', false)
              .eq('type', 'EXPENSE')
              .eq('description', `${card.name} ${year}년 ${month}월 정산`)
              .limit(1),
          ]);

          const billedTotal = (txRes.data ?? []).reduce(
            (s, t) => t.type === 'INCOME' ? s - t.amount : s + t.amount, 0
          );
          const settled = settledRes.data?.[0] ?? null;
          return {
            card,
            billingPeriod: period,
            billedTotal,
            settledAmount: settled ? Number(settled.amount) : null,
          };
        })
      );
      setCardStatuses(statuses);
    } finally {
      setStatusLoading(false);
    }
  }, [cards, year, month]);

  useEffect(() => {
    fetchAllCardStatuses();
  }, [fetchAllCardStatuses]);

  // 선택 카드 거래 상세 조회
  const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;
  const billingPeriod = selectedCard ? getBillingPeriod(year, month, selectedCard) : null;

  const fetchTransactions = useCallback(async () => {
    if (!selectedCardId || !billingPeriod || !selectedCard?.card_details) return;
    setLoadingTx(true);

    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const periodStart = `${toLocalStr(billingPeriod.start)}T00:00:00+09:00`;
    const periodEnd   = `${toLocalStr(billingPeriod.end)}T23:59:59+09:00`;

    const [txRes, descSettledRes, cardCatRes] = await Promise.all([
      supabase
        .from('transactions')
        .select('id, type, transacted_at, description, amount, categories(name)')
        .eq('asset_id', selectedCardId)
        .in('type', ['EXPENSE', 'INCOME'])
        .eq('is_deleted', false)
        .gte('transacted_at', periodStart)
        .lte('transacted_at', periodEnd)
        .order('transacted_at', { ascending: false }),
      supabase
        .from('transactions')
        .select('id, amount')
        .eq('is_deleted', false)
        .eq('type', 'EXPENSE')
        .eq('description', `${selectedCard.name} ${year}년 ${month}월 정산`)
        .limit(1),
      supabase
        .from('categories')
        .select('id')
        .eq('is_system', true)
        .eq('type', 'EXPENSE')
        .eq('name', selectedCard.name)
        .maybeSingle(),
    ]);

    if (txRes.data) setTransactions(txRes.data as unknown as Transaction[]);

    let settled = descSettledRes.data?.[0] ?? null;
    if (!settled && cardCatRes.data?.id) {
      const { data: catTxData } = await supabase
        .from('transactions')
        .select('id, amount')
        .eq('is_deleted', false)
        .eq('category_id', cardCatRes.data.id)
        .gte('transacted_at', `${monthStr}-01`)
        .lte('transacted_at', `${monthStr}-31T23:59:59`)
        .limit(1);
      settled = catTxData?.[0] ?? null;
    }

    setAlreadySettled(!!settled);
    setSettledAmount(settled ? Number(settled.amount) : null);
    setLoadingTx(false);
  }, [selectedCardId, year, month]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // 정산 실행
  const handleSettle = async () => {
    if (!selectedCard || !billingPeriod || !currentUser) return;
    const cd = selectedCard.card_details!;
    if (!cd.linked_asset_id) { toast.error('연결된 자동이체 계좌가 없습니다.'); return; }
    if (transactions.length === 0) { toast.error('정산할 거래 내역이 없습니다.'); return; }

    setSettling(true);
    try {
      let { data: rootCat } = await supabase
        .from('categories').select('id')
        .eq('is_system', true).eq('name', '카드정산').eq('type', 'EXPENSE').maybeSingle();
      if (!rootCat) {
        const { data: created, error } = await supabase
          .from('categories')
          .insert({ name: '카드정산', type: 'EXPENSE', is_system: true, is_visible: true, parent_id: null })
          .select('id').single();
        if (error) throw error;
        rootCat = created;
      }

      let { data: subCat } = await supabase
        .from('categories').select('id')
        .eq('parent_id', rootCat!.id).eq('name', selectedCard.name).maybeSingle();
      if (!subCat) {
        const { data: created, error } = await supabase
          .from('categories')
          .insert({ name: selectedCard.name, type: 'EXPENSE', is_system: true, is_visible: true, parent_id: rootCat!.id })
          .select('id').single();
        if (error) throw error;
        subCat = created;
      }

      const total = transactions.reduce((s, t) => t.type === 'INCOME' ? s - t.amount : s + t.amount, 0);
      const settlementDateIso = billingPeriod.settlementDate.toISOString();

      const { error } = await supabase.from('transactions').insert({
        type: 'EXPENSE',
        amount: total,
        asset_id: cd.linked_asset_id,
        category_id: subCat!.id,
        user_id: currentUser.id,
        group_id: group?.id ?? null,
        transacted_at: settlementDateIso,
        description: `${selectedCard.name} ${year}년 ${month}월 정산`,
        is_deleted: false,
      });
      if (error) throw error;

      toast.success(`${selectedCard.name} ${year}년 ${month}월 정산이 완료되었습니다.`);
      setAlreadySettled(true);
      fetchTransactions();
      fetchAllCardStatuses();
    } catch (e: any) {
      toast.error(`정산 실패: ${e.message}`);
    } finally {
      setSettling(false);
    }
  };

  const prevMonth = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  };

  const handleSelectCard = (cardId: string) => {
    setSelectedCardId(cardId);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  };

  const total = transactions.reduce((s, t) => t.type === 'INCOME' ? s - t.amount : s + t.amount, 0);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">불러오는 중...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <header className="bg-white border-b border-gray-100 px-4 py-3">
        <h1 className="font-bold text-gray-800">카드 정산</h1>
      </header>

      <main className="px-4 py-4 max-w-lg mx-auto space-y-4">

        {/* 결제년월 선택 */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <label className="text-xs text-gray-400 mb-2 block">결제년월</label>
          <div className="flex items-center gap-3">
            <button
              onClick={prevMonth}
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50"
            >‹</button>
            <span className="flex-1 text-center text-sm font-semibold text-gray-800">
              {year}년 {month}월
            </span>
            <button
              onClick={nextMonth}
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50"
            >›</button>
          </div>
        </div>

        {/* 카드 없음 */}
        {cards.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 px-4 py-10 text-center text-sm text-gray-400">
            등록된 신용카드가 없습니다.<br />
            <span className="text-xs mt-1 block">설정 &gt; 카드 관리에서 신용카드를 추가해주세요.</span>
          </div>
        )}

        {/* 카드별 정산 현황 대시보드 */}
        {cards.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-500 px-1">카드별 정산 현황</p>
            {statusLoading
              ? [...Array(cards.length)].map((_, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-100 px-4 py-4 animate-pulse">
                    <div className="flex items-center justify-between">
                      <div className="space-y-2">
                        <div className="h-4 w-32 bg-gray-100 rounded" />
                        <div className="h-3 w-48 bg-gray-100 rounded" />
                      </div>
                      <div className="h-8 w-20 bg-gray-100 rounded-xl" />
                    </div>
                  </div>
                ))
              : cardStatuses.map((cs) => {
                  const { card, billingPeriod: bp, billedTotal, settledAmount: sa } = cs;
                  const isSettled = sa !== null && sa === billedTotal;
                  const needsResettle = sa !== null && sa !== billedTotal;
                  const noTx = billedTotal === 0 && sa === null;

                  return (
                    <div
                      key={card.id}
                      className={`bg-white rounded-2xl border px-4 py-4 transition-all ${
                        selectedCardId === card.id ? 'border-blue-300 shadow-md shadow-blue-50' : 'border-gray-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-gray-800 truncate">{card.name}</p>
                          {bp && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {fmtDate(bp.start)} ~ {fmtDate(bp.end)}
                            </p>
                          )}
                          <div className="flex gap-3 mt-2 text-xs">
                            <span className="text-gray-500">
                              청구&nbsp;
                              <span className={`font-semibold ${billedTotal > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                {billedTotal > 0 ? `-${billedTotal.toLocaleString('ko-KR')}원` : '-'}
                              </span>
                            </span>
                            <span className="text-gray-300">|</span>
                            <span className="text-gray-500">
                              정산&nbsp;
                              <span className={`font-semibold ${
                                sa === null ? 'text-gray-400'
                                : needsResettle ? 'text-red-500'
                                : 'text-green-600'
                              }`}>
                                {sa !== null ? `-${sa.toLocaleString('ko-KR')}원` : '미정산'}
                              </span>
                            </span>
                          </div>
                        </div>

                        {/* 상태 버튼 */}
                        <div className="shrink-0">
                          {noTx ? (
                            <span className="inline-block text-xs text-gray-400 bg-gray-100 px-3 py-1.5 rounded-xl font-medium">
                              내역없음
                            </span>
                          ) : isSettled ? (
                            <span className="inline-block text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-xl font-medium">
                              정산완료
                            </span>
                          ) : needsResettle ? (
                            <button
                              onClick={() => handleSelectCard(card.id)}
                              className="text-xs text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-xl font-bold transition-colors"
                            >
                              재정산
                            </button>
                          ) : (
                            <button
                              onClick={() => handleSelectCard(card.id)}
                              className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-xl font-bold transition-colors"
                            >
                              정산하기
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
          </div>
        )}

        {/* 상세 영역 (카드 선택 시) */}
        {selectedCardId && selectedCard && (
          <div ref={detailRef} className="space-y-3 pt-2">
            <p className="text-xs font-bold text-gray-500 px-1">{selectedCard.name} 상세</p>

            {/* 청구 정보 */}
            {billingPeriod && selectedCard.card_details && (
              <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">청구 정보</p>
                <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                  <span className="text-gray-400 text-xs">청구 기간</span>
                  <span className="text-gray-700 text-xs font-medium">
                    {fmtDate(billingPeriod.start)} ~ {fmtDate(billingPeriod.end)}
                  </span>
                  <span className="text-gray-400 text-xs">결제일</span>
                  <span className="text-gray-700 text-xs font-medium">
                    {billingPeriod.settlementDate.getFullYear()}.{String(billingPeriod.settlementDate.getMonth() + 1).padStart(2, '0')}.{String(billingPeriod.settlementDate.getDate()).padStart(2, '0')}
                  </span>
                  <span className="text-gray-400 text-xs">연결 계좌</span>
                  <span className={`text-xs font-medium ${selectedCard.card_details.linked_asset_id ? 'text-gray-700' : 'text-red-400'}`}>
                    {selectedCard.card_details.linked_asset
                      ? (selectedCard.card_details.linked_asset as any)?.name ?? '-'
                      : '연결된 계좌 없음'}
                  </span>
                </div>
              </div>
            )}

            {/* 합계 + 정산 버튼 */}
            <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400">청구 금액 합계</p>
                  <p className={`text-xl font-bold mt-0.5 ${total >= 0 ? 'text-red-500' : 'text-green-600'}`}>
                    {loadingTx ? '…' : `${total >= 0 ? '-' : '+'}${Math.abs(total).toLocaleString('ko-KR')}원`}
                  </p>
                  {!loadingTx && (
                    <p className="text-xs text-gray-400 mt-0.5">{transactions.length}건</p>
                  )}
                  {alreadySettled && settledAmount !== null && (
                    <p className="text-xs text-green-600 mt-1">
                      정산 금액: -{settledAmount.toLocaleString('ko-KR')}원
                    </p>
                  )}
                </div>
                <button
                  onClick={handleSettle}
                  disabled={settling || loadingTx || total === 0 || !selectedCard?.card_details?.linked_asset_id}
                  className={`px-5 py-2.5 text-white text-sm font-bold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm ${
                    alreadySettled ? 'bg-red-500 hover:bg-red-600 shadow-red-200' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
                  }`}
                >
                  {settling ? '처리 중…' : alreadySettled ? '재정산' : '정산하기'}
                </button>
              </div>
              {!selectedCard?.card_details?.linked_asset_id && (
                <p className="text-xs text-red-400 bg-red-50 rounded-lg px-3 py-2 mt-3">
                  자동이체 연결 계좌가 없습니다. 설정 &gt; 카드 관리에서 연결 계좌를 지정해주세요.
                </p>
              )}
            </div>

            {/* 거래 내역 */}
            {loadingTx ? (
              <div className="text-center py-8 text-gray-400 text-sm">불러오는 중...</div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">해당 월에 청구될 거래 내역이 없습니다.</div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-400">거래 내역</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center px-4 py-3 gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{tx.description ?? '-'}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {toDateStr(tx.transacted_at)}
                          {tx.categories?.name && <span className="ml-2">{tx.categories.name}</span>}
                          {tx.type === 'INCOME' && <span className="ml-2 text-green-600 font-medium">수입</span>}
                        </p>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ${tx.type === 'INCOME' ? 'text-green-600' : 'text-red-500'}`}>
                        {tx.type === 'INCOME' ? '+' : '-'}{tx.amount.toLocaleString('ko-KR')}원
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
