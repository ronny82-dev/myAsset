'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase';
import { useGroup } from '@/context/GroupContext';
import toast from 'react-hot-toast';

interface Category {
  id: number;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  is_visible: boolean;
  is_system: boolean;
  user_id: string | null;
  group_id: string | null;
  parent_id: number | null;
  sort_order?: number | null;
}

interface Card {
  id: string;
  name: string;
  is_active: boolean;
  card_type: 'CREDIT' | 'CHECK' | null;
}

type TabType = 'EXPENSE' | 'INCOME';

export default function CategoriesPage() {
  const { group, currentUser } = useGroup();
  const [categories, setCategories] = useState<Category[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [tab, setTab] = useState<TabType>('EXPENSE');
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchCategories = async () => {
    setLoading(true);
    const [{ data, error }, { data: cardData }] = await Promise.all([
      supabase
        .from('categories')
        .select('id, name, type, is_visible, is_system, user_id, group_id, parent_id, sort_order')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true }),
      supabase
        .from('assets')
        .select('id, name, is_active, card_details!card_details_asset_id_fkey(card_type)')
        .eq('type', 'CARD')
        .order('name'),
    ]);

    if (error) {
      const errorMessage = error.message || JSON.stringify(error);
      console.error('카테고리 로딩 에러 상세:', errorMessage, error);
      toast.error(`카테고리 로딩 오류: ${errorMessage}`);
    }
    if (data) setCategories(data as Category[]);
    if (cardData) {
      setCards(cardData.map((c: any) => ({
        id: c.id,
        name: c.name,
        is_active: c.is_active,
        card_type: c.card_details?.card_type ?? null,
      })));
    }
    setLoading(false);
  };

  useEffect(() => { fetchCategories(); }, []);

  const handleAdd = async () => {
    if (!newName.trim() || !currentUser) return;
    setAdding(true);
    const { error } = await supabase.from('categories').insert({
      name: newName.trim(),
      type: tab,
      user_id: currentUser.id,
      group_id: group?.id ?? null,
      is_visible: true,
      parent_id: selectedParentId,
    });
    if (!error) {
      setNewName('');
      setShowAddForm(false);
      setSelectedParentId(null);
      await fetchCategories();
    }
    setAdding(false);
  };

  const toggleVisible = async (cat: Category) => {
    await supabase.from('categories').update({ is_visible: !cat.is_visible }).eq('id', cat.id);
    setCategories((prev) => prev.map((c) => c.id === cat.id ? { ...c, is_visible: !c.is_visible } : c));
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditName(cat.name);
  };

  const saveEdit = async (id: number) => {
    if (!editName.trim()) return;
    await supabase.from('categories').update({ name: editName.trim() }).eq('id', id);
    setCategories((prev) => prev.map((c) => c.id === id ? { ...c, name: editName.trim() } : c));
    setEditingId(null);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('카테고리를 삭제할까요? 연결된 거래 내역은 유지됩니다.')) return;
    await supabase.from('categories').delete().eq('id', id);
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetId: number, parentId: number | null) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) return;

    const draggedCat = categories.find((c) => c.id === draggedId);
    const targetCat = categories.find((c) => c.id === targetId);

    if (!draggedCat || !targetCat || draggedCat.parent_id !== targetCat.parent_id) {
      toast.error('같은 계층 내에서만 순서를 변경할 수 있습니다.');
      setDraggedId(null);
      return;
    }

    const levelItems = categories.filter((c) => c.type === tab && c.parent_id === parentId);
    const draggedIndex = levelItems.findIndex((c) => c.id === draggedId);
    const targetIndex = levelItems.findIndex((c) => c.id === targetId);

    const newLevelItems = [...levelItems];
    const [removed] = newLevelItems.splice(draggedIndex, 1);
    newLevelItems.splice(targetIndex, 0, removed);

    const updates = newLevelItems.map((cat, index) => ({ id: cat.id, sort_order: index + 1 }));

    setCategories((prev) => {
      const updated = prev.map((c) => {
        const update = updates.find((u) => u.id === c.id);
        return update ? { ...c, sort_order: update.sort_order } : c;
      });
      return updated.sort((a, b) => (a.sort_order ?? a.id) - (b.sort_order ?? b.id));
    });
    setDraggedId(null);

    try {
      await Promise.all(updates.map((u) => supabase.from('categories').update({ sort_order: u.sort_order }).eq('id', u.id)));
    } catch (error: any) {
      const errorMessage = error?.message || JSON.stringify(error);
      console.error('카테고리 순서 저장 에러 상세:', errorMessage, error);
      toast.error(`순서 저장 오류: ${errorMessage}`);
      fetchCategories();
    }
  };

  const filtered = categories.filter((c) => c.type === tab);
  const rootCategories = filtered.filter((c) => !c.parent_id);
  const getSubCategories = (parentId: number) => filtered.filter((c) => c.parent_id === parentId);

  return (
    <main className="px-4 py-4 max-w-lg mx-auto space-y-4 pb-8">
      {/* 탭 */}
      <div className="flex bg-gray-100 rounded-xl p-1">
        {(['EXPENSE', 'INCOME'] as TabType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            {t === 'EXPENSE' ? '지출' : '수입'}
          </button>
        ))}
      </div>

      {/* 카테고리 목록 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <p className="text-center py-8 text-gray-400 text-sm">불러오는 중...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-gray-400 text-sm">카테고리가 없습니다.</p>
        ) : (
          <div className="flex flex-col">
            {rootCategories.map((rootCat) => (
              <div key={rootCat.id} className="border-b border-gray-100 last:border-0">
              <div
                draggable={!rootCat.is_system}
                onDragStart={rootCat.is_system ? undefined : (e) => handleDragStart(e, rootCat.id)}
                onDragOver={rootCat.is_system ? undefined : handleDragOver}
                onDrop={rootCat.is_system ? undefined : (e) => handleDrop(e, rootCat.id, null)}
                onDragEnd={rootCat.is_system ? undefined : () => setDraggedId(null)}
                className={`flex items-center px-4 py-3 gap-3 transition-opacity ${!rootCat.is_visible ? 'opacity-40' : ''} ${draggedId === rootCat.id ? 'opacity-30 bg-gray-50' : ''}`}
              >
                {/* 드래그 핸들 or 시스템 잠금 아이콘 */}
                {rootCat.is_system ? (
                  <div className="text-gray-300 shrink-0" title="시스템 카테고리 (수정 불가)">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                ) : (
                  <div className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16"></path></svg>
                  </div>
                )}

                  {/* 가시성 토글 (시스템 카테고리는 비활성) */}
                  <button
                    onClick={() => !rootCat.is_system && toggleVisible(rootCat)}
                    className={`text-lg shrink-0 ${rootCat.is_system ? 'opacity-30 cursor-default' : ''}`}
                    title={rootCat.is_system ? '시스템 카테고리' : rootCat.is_visible ? '숨기기' : '표시하기'}
                  >
                    {rootCat.is_visible ? '👁' : '🙈'}
                  </button>

                  {/* 상위 카테고리 이름 */}
                  <div
                    className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer"
                    onClick={() => editingId !== rootCat.id && toggleExpand(rootCat.id)}
                  >
                    {editingId === rootCat.id ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(rootCat.id); if (e.key === 'Escape') setEditingId(null); }}
                        className="w-full text-sm text-gray-900 border-b-2 border-blue-500 focus:outline-none bg-transparent"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span className="text-sm font-bold text-gray-800">{rootCat.name}</span>
                        {rootCat.is_system && (
                          <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full font-medium">
                            {rootCat.name === '카드정산' ? '카드 연동' : '자산 연동'}
                          </span>
                        )}
                        {!rootCat.is_system && getSubCategories(rootCat.id).length > 0 && (
                          <span className="text-xs text-gray-400">{getSubCategories(rootCat.id).length}개</span>
                        )}
                      </>
                    )}
                  </div>

                  {/* 펼치기/접기 chevron */}
                  {editingId !== rootCat.id && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(rootCat.id)}
                      className="text-gray-300 hover:text-gray-500 shrink-0 transition-transform duration-200"
                      style={{ transform: expandedIds.has(rootCat.id) ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  )}

                  {/* 상위 카테고리 액션 (시스템 카테고리는 숨김) */}
                  {!rootCat.is_system && (
                    editingId === rootCat.id ? (
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => saveEdit(rootCat.id)} className="text-xs text-blue-600 font-medium">저장</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-400">취소</button>
                      </div>
                    ) : (
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => startEdit(rootCat)} className="text-xs text-gray-400 hover:text-blue-500">수정</button>
                        <button onClick={() => handleDelete(rootCat.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
                      </div>
                    )
                  )}
                </div>

                {/* 하위 카테고리 목록 */}
                {expandedIds.has(rootCat.id) && (
                  <div className="bg-gray-50 border-t border-gray-100">
                    {/* 시스템 카테고리: 카드정산은 등록된 카드 목록 표시, 나머지는 자산 연동 안내 */}
                    {rootCat.is_system && rootCat.name === '카드정산' && (
                      cards.length === 0 ? (
                        <div className="px-10 py-3 text-xs text-gray-400 flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          등록된 카드가 없습니다. 카드를 먼저 등록해주세요.
                        </div>
                      ) : (
                        cards.map((card) => (
                          <div key={card.id} className={`flex items-center px-4 py-2.5 gap-3 border-b border-gray-100 last:border-0 pl-10 ${!card.is_active ? 'opacity-40' : ''}`}>
                            <div className="text-gray-200 shrink-0">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                            </div>
                            <span className="text-gray-300 text-xs">↳</span>
                            <span className="text-sm text-gray-500 flex-1 truncate">{card.name}</span>
                            {card.card_type && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                                card.card_type === 'CREDIT' ? 'bg-red-100 text-red-400' : 'bg-blue-100 text-blue-400'
                              }`}>
                                {card.card_type === 'CREDIT' ? '신용' : '체크'}
                              </span>
                            )}
                            {!card.is_active && (
                              <span className="text-[10px] text-gray-300">비활성</span>
                            )}
                          </div>
                        ))
                      )
                    )}
                    {rootCat.is_system && rootCat.name !== '카드정산' && getSubCategories(rootCat.id).length === 0 && (
                      <div className="px-10 py-3 text-xs text-gray-400 flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        소분류는 등록된 자산/계좌 목록과 자동으로 연동됩니다.
                      </div>
                    )}
                    {rootCat.is_system && rootCat.name !== '카드정산' && getSubCategories(rootCat.id).map((subCat) => (
                      <div key={subCat.id} className="flex items-center px-4 py-2.5 gap-3 border-b border-gray-100 last:border-0 pl-10">
                        <div className="text-gray-200 shrink-0">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                        </div>
                        <span className="text-gray-300 text-xs">↳</span>
                        <span className="text-sm text-gray-500 flex-1 truncate">{subCat.name}</span>
                      </div>
                    ))}
                    {!rootCat.is_system && getSubCategories(rootCat.id).map((subCat) => (
                  <div
                    key={subCat.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, subCat.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, subCat.id, rootCat.id)}
                    onDragEnd={() => setDraggedId(null)}
                    className={`flex items-center px-4 py-2.5 gap-3 border-b border-gray-100 last:border-0 pl-10 transition-opacity ${!subCat.is_visible ? 'opacity-40' : ''} ${draggedId === subCat.id ? 'opacity-30 bg-gray-100' : ''}`}
                  >
                    {/* 하위 카테고리 드래그 핸들 */}
                    <div className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16"></path></svg>
                    </div>
                        <button
                          onClick={() => toggleVisible(subCat)}
                          className="text-base shrink-0"
                          title={subCat.is_visible ? '숨기기' : '표시하기'}
                        >
                          {subCat.is_visible ? '👁' : '🙈'}
                        </button>
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-gray-300 text-xs">↳</span>
                          {editingId === subCat.id ? (
                            <input
                              autoFocus
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(subCat.id); if (e.key === 'Escape') setEditingId(null); }}
                              className="w-full text-sm text-gray-900 border-b-2 border-blue-500 focus:outline-none bg-transparent"
                            />
                          ) : (
                            <span className="text-sm text-gray-700">{subCat.name}</span>
                          )}
                        </div>
                        {editingId === subCat.id ? (
                          <div className="flex gap-2 shrink-0">
                            <button onClick={() => saveEdit(subCat.id)} className="text-xs text-blue-600 font-medium">저장</button>
                            <button onClick={() => setEditingId(null)} className="text-xs text-gray-400">취소</button>
                          </div>
                        ) : (
                          <div className="flex gap-2 shrink-0">
                            <button onClick={() => startEdit(subCat)} className="text-xs text-gray-400 hover:text-blue-500">수정</button>
                            <button onClick={() => handleDelete(subCat.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 카테고리 추가 */}
      {showAddForm ? (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-medium text-gray-700 mb-3">
            {tab === 'EXPENSE' ? '지출' : '수입'} 카테고리 추가
          </p>
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-2">추가할 위치</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedParentId(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  selectedParentId === null
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                }`}
              >
                대분류
              </button>
              {rootCategories.filter((r) => !r.is_system).map((root) => (
                <button
                  key={root.id}
                  type="button"
                  onClick={() => setSelectedParentId(root.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    selectedParentId === root.id
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  {root.name} 하위
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="카테고리 이름"
              className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50"
            >
              추가
            </button>
            <button onClick={() => { setShowAddForm(false); setNewName(''); setSelectedParentId(null); }} className="px-3 py-2 text-sm text-gray-400 rounded-xl hover:bg-gray-100">
              취소
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full py-3 border-2 border-dashed border-gray-300 rounded-2xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          + {tab === 'EXPENSE' ? '지출' : '수입'} 카테고리 추가
        </button>
      )}
    </main>
  );
}
