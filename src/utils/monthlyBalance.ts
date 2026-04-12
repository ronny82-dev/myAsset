import { supabase } from './supabase';

const LIABILITY_CALC_TYPES = ['LOAN', 'OTHER_LIABILITY'];

/** 거래 1건의 잔액 영향 계산 */
export function txDelta(amount: number, type: string, assetType: string): number {
  const isLiability = LIABILITY_CALC_TYPES.includes(assetType);
  if (isLiability) {
    return type === 'INCOME' ? -amount : amount;
  }
  return type === 'INCOME' ? amount : -amount;
}

/** 'YYYY-MM' → 다음 달 'YYYY-MM' */
function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1); // JS month 0-indexed이므로 m = 다음달
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' 말일 KST ISO 문자열 */
function monthEndStr(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${String(last).padStart(2, '0')}T23:59:59+09:00`;
}

/**
 * 특정 자산의 특정 월 기말잔액을 반환합니다.
 * - 캐시(asset_monthly_balances)가 있으면 즉시 반환
 * - 없으면 직전 캐시 월부터 계산 후 저장
 */
export async function getClosingBalance(
  assetId: string,
  assetType: string,
  initialBalance: number,
  yearMonth: string,
): Promise<number> {
  if (yearMonth < '2025-01') return initialBalance;

  // 캐시 확인
  const { data: cached } = await supabase
    .from('asset_monthly_balances')
    .select('closing_balance')
    .eq('asset_id', assetId)
    .eq('year_month', yearMonth)
    .maybeSingle();
  if (cached) return Number(cached.closing_balance);

  // 직전 캐시된 월 조회
  const { data: prev } = await supabase
    .from('asset_monthly_balances')
    .select('year_month, closing_balance')
    .eq('asset_id', assetId)
    .lt('year_month', yearMonth)
    .order('year_month', { ascending: false })
    .limit(1)
    .maybeSingle();

  let opening: number;
  let fromMonth: string;

  if (prev) {
    opening = Number(prev.closing_balance);
    fromMonth = nextMonth(prev.year_month);
  } else {
    opening = initialBalance;
    fromMonth = '2025-01';
  }

  // fromMonth ~ yearMonth 거래 일괄 조회
  const { data: txs } = await supabase
    .from('transactions')
    .select('amount, type, transacted_at')
    .eq('asset_id', assetId)
    .eq('is_deleted', false)
    .gte('transacted_at', `${fromMonth}-01T00:00:00+09:00`)
    .lte('transacted_at', monthEndStr(yearMonth))
    .order('transacted_at', { ascending: true });

  // 월별 거래 합계
  const txByMonth: Record<string, number> = {};
  for (const tx of txs ?? []) {
    const d = new Date(tx.transacted_at);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    txByMonth[ym] = (txByMonth[ym] ?? 0) + txDelta(tx.amount, tx.type, assetType);
  }

  // 월별 기말잔액 계산 & 캐시 저장
  const upserts: any[] = [];
  let current = fromMonth;
  while (current <= yearMonth) {
    const closing = opening + (txByMonth[current] ?? 0);
    upserts.push({
      asset_id: assetId,
      year_month: current,
      closing_balance: closing,
      updated_at: new Date().toISOString(),
    });
    opening = closing;
    if (current === yearMonth) break;
    current = nextMonth(current);
  }

  if (upserts.length > 0) {
    await supabase
      .from('asset_monthly_balances')
      .upsert(upserts, { onConflict: 'asset_id,year_month' });
  }

  return opening; // = yearMonth의 기말잔액
}

/**
 * 특정 자산의 fromYearMonth 이후 캐시를 삭제합니다.
 * 거래 추가/수정/삭제 시 호출합니다.
 */
export async function invalidateFrom(assetId: string, fromYearMonth: string): Promise<void> {
  if (!assetId || !fromYearMonth) return;
  await supabase
    .from('asset_monthly_balances')
    .delete()
    .eq('asset_id', assetId)
    .gte('year_month', fromYearMonth.slice(0, 7));
}

/**
 * 모든 활성 자산의 월별 기말잔액을 2025-01부터 현재 월까지 전체 재계산합니다.
 */
export async function populateAllBalances(): Promise<void> {
  const { data: assets } = await supabase
    .from('assets')
    .select('id, type, initial_balance')
    .eq('is_active', true);

  if (!assets?.length) return;

  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  await Promise.all(assets.map(async (asset: any) => {
    // 자산별 2025-01 ~ 현재 월 거래 일괄 조회
    const { data: txs } = await supabase
      .from('transactions')
      .select('amount, type, transacted_at')
      .eq('asset_id', asset.id)
      .eq('is_deleted', false)
      .gte('transacted_at', '2025-01-01T00:00:00+09:00')
      .lte('transacted_at', monthEndStr(currentYM))
      .order('transacted_at', { ascending: true });

    // 월별 거래 합계
    const txByMonth: Record<string, number> = {};
    for (const tx of txs ?? []) {
      const d = new Date(tx.transacted_at);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      txByMonth[ym] = (txByMonth[ym] ?? 0) + txDelta(tx.amount, tx.type, asset.type);
    }

    // 2025-01부터 현재 월까지 기말잔액 계산
    let opening = asset.initial_balance ?? 0;
    let month = '2025-01';
    const upserts: any[] = [];

    while (month <= currentYM) {
      const closing = opening + (txByMonth[month] ?? 0);
      upserts.push({
        asset_id: asset.id,
        year_month: month,
        closing_balance: closing,
        updated_at: new Date().toISOString(),
      });
      opening = closing;
      if (month === currentYM) break;
      month = nextMonth(month);
    }

    if (upserts.length > 0) {
      await supabase
        .from('asset_monthly_balances')
        .upsert(upserts, { onConflict: 'asset_id,year_month' });
    }
  }));
}
