'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/utils/supabase';

interface Member {
  id: string;
  nickname: string;
  email: string;
}

interface Group {
  id: string;
  name: string;
  start_day_of_month: number;
  primary_currency: string;
}

interface GroupContextType {
  group: Group | null;
  members: Member[];
  currentUser: Member | null;
  loading: boolean;
  refreshGroup: () => Promise<void>;
}

const GroupContext = createContext<GroupContextType>({
  group: null,
  members: [],
  currentUser: null,
  loading: true,
  refreshGroup: async () => {},
});

export function GroupProvider({ children }: { children: ReactNode }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUser, setCurrentUser] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchGroup = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // 현재 유저 정보
      const { data: me } = await supabase
        .from('users')
        .select('id, nickname, email')
        .eq('id', user.id)
        .single();
      if (me) setCurrentUser(me);

      // 그룹 정보
      const { data: membership } = await supabase
        .from('group_members')
        .select('group_id, groups(id, name, start_day_of_month, primary_currency)')
        .eq('user_id', user.id)
        .limit(1)
        .single();

      if (!membership) { setLoading(false); return; }

      const g = (membership as any).groups as Group;
      setGroup(g);

      // 그룹 멤버 목록
      const { data: gm } = await supabase
        .from('group_members')
        .select('users(id, nickname, email)')
        .eq('group_id', g.id);

      if (gm) {
        setMembers(gm.map((row: any) => row.users).filter(Boolean));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroup();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchGroup();
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <GroupContext.Provider value={{ group, members, currentUser, loading, refreshGroup: fetchGroup }}>
      {children}
    </GroupContext.Provider>
  );
}

export const useGroup = () => useContext(GroupContext);
