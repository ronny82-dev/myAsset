import { NextRequest, NextResponse } from 'next/server';
import { AzureOpenAI } from 'openai';

export async function POST(req: NextRequest) {
  const { description, transactionType, categories } = await req.json();

  if (!description || description.trim().length < 2) {
    return NextResponse.json({ categoryId: null, categoryName: null, isNew: false });
  }

  const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-02-01',
  });

  const categoryList = (categories as { id: string | number; name: string }[])
    .map((c) => `id:${c.id} name:${c.name}`)
    .join(', ');

  const prompt = `가계부 카테고리 분류 전문가입니다.
거래 유형: ${transactionType === 'EXPENSE' ? '지출' : '수입'}
적요: "${description}"
카테고리 목록: ${categoryList || '없음'}

위 카테고리 중 가장 적합한 것을 선택하거나, 적합한 것이 없으면 짧고 명확한 새 카테고리 이름을 한국어로 제안하세요.
반드시 JSON으로만 응답하세요: {"categoryId": <숫자 id 또는 null>, "categoryName": "<이름>", "isNew": <true/false>}`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 100,
      temperature: 0,
    });

    const result = JSON.parse(response.choices[0].message.content ?? '{}');
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ categoryId: null, categoryName: null, isNew: false });
  }
}
