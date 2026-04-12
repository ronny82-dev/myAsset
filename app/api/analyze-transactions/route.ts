import { NextRequest, NextResponse } from 'next/server';
import { AzureOpenAI } from 'openai';
import { requireAuth } from '@/utils/supabase-server';

interface CategoryOption { id: number; label: string; type: string; }

interface AnalyzedTransaction {
  transactedAt: string;
  type: 'EXPENSE' | 'INCOME';
  description: string;
  amount: number | null;
  categoryId: number | null;
  categoryLabel: string | null;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

export async function POST(req: NextRequest) {
  // 인증 확인
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const categoriesRaw = formData.get('categories') as string | null;

  if (!file) {
    return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
  }

  // 파일 크기 검증 (5MB 초과 차단)
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: '파일 크기는 5MB 이하여야 합니다.' }, { status: 400 });
  }

  // MIME 타입 검증
  const mimeType = file.type || 'image/jpeg';
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: '지원하지 않는 이미지 형식입니다. (JPEG, PNG, WebP, GIF, HEIC 허용)' }, { status: 400 });
  }

  let categories: CategoryOption[] = [];
  try {
    categories = categoriesRaw ? JSON.parse(categoriesRaw) : [];
  } catch {
    return NextResponse.json({ error: '카테고리 데이터 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    deployment: process.env.AZURE_OPENAI_VISION_DEPLOYMENT_NAME ?? process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-02-01',
  });

  const expenseCategories = categories.filter((c) => c.type === 'EXPENSE');
  const incomeCategories = categories.filter((c) => c.type === 'INCOME');

  const catListText = (list: CategoryOption[]) =>
    list.length > 0
      ? list.map((c) => `  [id:${c.id}] ${c.label}`).join('\n')
      : '  (없음)';

  const prompt = `당신은 은행 거래내역 분석 전문가입니다. 첨부된 이미지는 은행 앱 또는 카드사의 거래내역 캡처 화면입니다.
이미지에서 모든 거래 내역을 추출하여 아래 JSON 배열 형식으로 응답하세요.

지출 카테고리 목록:
${catListText(expenseCategories)}

수입 카테고리 목록:
${catListText(incomeCategories)}

지침:
1. 이미지에 보이는 모든 거래를 빠짐없이 추출하세요.
2. 각 거래의 날짜는 "YYYY-MM-DD" 형식으로 변환하세요. 연도가 없으면 올해(${new Date().getFullYear()})로 가정하세요.
3. type: 출금/결제/이체출금은 "EXPENSE", 입금/급여/이자는 "INCOME"으로 분류하세요.
4. description: 가맹점명, 적요, 메모 등 거래를 설명하는 내용을 그대로 추출하세요.
5. amount: 금액은 양수 정수(원 단위)로 입력하세요. 읽을 수 없으면 null.
6. categoryId: 위 카테고리 목록에서 description과 type에 가장 적합한 카테고리의 id를 선택하세요. 적합한 것이 없으면 null.

JSON 응답 (배열):
[
  {
    "transactedAt": "<YYYY-MM-DD>",
    "type": "<EXPENSE 또는 INCOME>",
    "description": "<거래 내용>",
    "amount": <금액 숫자 또는 null>,
    "categoryId": <카테고리 id 정수 또는 null>
  }
]`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_VISION_DEPLOYMENT_NAME ?? process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0,
    });

    const raw = response.choices[0].message.content ?? '[]';
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\[[\s\S]*\])/);
    const parsed: any[] = JSON.parse(jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : raw);

    const today = new Date().toISOString().split('T')[0];
    const transactions: AnalyzedTransaction[] = parsed.map((item) => {
      const type: 'EXPENSE' | 'INCOME' = item.type === 'INCOME' ? 'INCOME' : 'EXPENSE';
      const catId = item.categoryId != null ? Number(item.categoryId) : null;
      const matched = catId != null ? categories.find((c) => c.id === catId && c.type === type) : null;
      const dateStr = typeof item.transactedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.transactedAt)
        ? item.transactedAt
        : today;
      return {
        transactedAt: dateStr,
        type,
        description: typeof item.description === 'string' ? item.description.trim() : '',
        amount: item.amount != null ? Number(item.amount) : null,
        categoryId: matched ? matched.id : null,
        categoryLabel: matched ? matched.label : null,
      };
    });

    return NextResponse.json({ transactions });
  } catch (e) {
    console.error('analyze-transactions error:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: '거래내역 분석에 실패했습니다. 다시 시도해주세요.' }, { status: 500 });
  }
}
