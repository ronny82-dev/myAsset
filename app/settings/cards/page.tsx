'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/utils/supabase';

interface Card {
  id: string;
  name: string;
  is_active: boolean;
  card_details: {
    card_type: 'CREDIT' | 'CHECK';
    settlement_day: number;
  } | null;
}

export default function CardsPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCards = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('assets')
      .select('id, name, is_active, card_details!card_details_asset_id_fkey(card_type, settlement_day)')
      .eq('type', 'CARD')
      .order('name');
    if (data) setCards(data as unknown as Card[]);
    setLoading(false);
  };

  useEffect(() => { fetchCards(); }, []);

  const toggleActive = async (card: Card) => {
    await supabase.from('assets').update({ is_active: !card.is_active }).eq('id', card.id);
    setCards((prev) => prev.map((c) => c.id === card.id ? { ...c, is_active: !card.is_active } : c));
  };

  return (
    <main className="px-4 py-4 max-w-lg mx-auto space-y-4 pb-8">
      {loading ? (
        <p className="text-center py-12 text-gray-400 text-sm">불러오는 중...</p>
      ) : cards.length === 0 ? (
        <p className="text-center py-8 text-gray-400 text-sm">등록된 카드가 없습니다.</p>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50 overflow-hidden">
          {cards.map((card) => (
            <div key={card.id} className={`flex items-center px-4 py-3 gap-3 ${!card.is_active ? 'opacity-40' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-800 truncate">{card.name}</p>
                  {card.card_details && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                      card.card_details.card_type === 'CREDIT'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-blue-100 text-blue-600'
                    }`}>
                      {card.card_details.card_type === 'CREDIT' ? '신용' : '체크'}
                    </span>
                  )}
                </div>
                {card.card_details && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    매월 {card.card_details.settlement_day}일 결제
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => toggleActive(card)}
                  className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${card.is_active ? 'bg-blue-500' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${card.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
                <Link href={`/settings/cards/${card.id}`} className="text-xs text-gray-400 hover:text-blue-500 px-1">
                  편집
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <Link
        href="/settings/cards/new"
        className="block w-full py-4 border-2 border-dashed border-gray-300 rounded-2xl text-sm text-gray-500 text-center hover:border-blue-400 hover:text-blue-500 transition-colors"
      >
        + 카드 추가
      </Link>
    </main>
  );
}
