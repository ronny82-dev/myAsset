import { NextRequest, NextResponse } from 'next/server';
import { AzureOpenAI } from 'openai';
import { requireAuth } from '@/utils/supabase-server';
import { createSupabaseServer } from '@/utils/supabase-server';

export async function POST(req: NextRequest) {
  const openai = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-02-01',
  });
  // 인증 + 그룹 확인
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { groupId } = auth;
  if (!groupId) {
    return NextResponse.json({ error: '그룹에 참여 후 이용할 수 있습니다.' }, { status: 403 });
  }

  const supabase = await createSupabaseServer();

  // 최근 3개월 지출 데이터 집계 (본인 그룹 데이터만)
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const { data: txData } = await supabase
    .from('transactions')
    .select('amount, type, transacted_at, categories(name), users(nickname)')
    .eq('group_id', groupId)
    .gte('transacted_at', threeMonthsAgo.toISOString())
    .eq('is_deleted', false)
    .eq('type', 'EXPENSE');

  if (!txData || txData.length === 0) {
    return NextResponse.json({ insight: '아직 분석할 지출 데이터가 부족합니다. 지출을 기록하면 AI 분석이 시작됩니다!' });
  }

  // 월별 × 카테고리별 집계
  const summary: Record<string, Record<string, number>> = {};
  const memberSummary: Record<string, number> = {};

  for (const tx of txData as any[]) {
    const month = tx.transacted_at.slice(0, 7);
    const cat = tx.categories?.name ?? '미분류';
    const member = tx.users?.nickname ?? '알 수 없음';

    if (!summary[month]) summary[month] = {};
    summary[month][cat] = (summary[month][cat] ?? 0) + tx.amount;
    memberSummary[member] = (memberSummary[member] ?? 0) + tx.amount;
  }

  const prompt = `당신은 부부/커플의 가계부를 분석하는 재무 코치입니다. 아래 데이터를 바탕으로 친근하고 유익한 소비 분석 리포트를 한국어로 작성해주세요.

[최근 3개월 카테고리별 지출 (원)]
${JSON.stringify(summary, null, 2)}

[멤버별 총 지출]
${JSON.stringify(memberSummary, null, 2)}

다음 항목을 포함해 분석해주세요:
1. 전체 소비 패턴 요약 (2-3문장)
2. 가장 많이 지출한 카테고리와 절약 팁
3. 멤버별 지출 기여도 및 균형 여부
4. 전월 대비 증가/감소한 카테고리
5. 이번 달 추천 절약 목표

각 항목은 이모지를 활용하여 읽기 쉽게 작성해주세요. 전체 500자 이내로 간결하게.`;

  try {
    const response = await openai.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const insight = response.choices[0].message.content ?? '';
    return NextResponse.json({ insight });
  } catch (e) {
    console.error('insights error:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'AI 분석에 실패했습니다. 다시 시도해주세요.' }, { status: 500 });
  }
}
