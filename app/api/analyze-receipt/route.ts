import { NextRequest, NextResponse } from 'next/server';
import { AzureOpenAI } from 'openai';
import { requireAuth } from '@/utils/supabase-server';

interface SubCategory { id: string | number; name: string; }
interface CategoryTree { id: string | number; name: string; subCategories: SubCategory[]; }

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

export async function POST(req: NextRequest) {
  // 인증 확인
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const transactionType = (formData.get('transactionType') as string) ?? 'EXPENSE';
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

  let categories: CategoryTree[] = [];
  try {
    categories = categoriesRaw ? JSON.parse(categoriesRaw) : [];
  } catch {
    return NextResponse.json({ error: '카테고리 데이터 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  // 이미지를 base64로 변환
  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    deployment: process.env.AZURE_OPENAI_VISION_DEPLOYMENT_NAME ?? process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-02-01',
  });

  const treeText = categories.map((root, i) => {
    const subs = root.subCategories.length > 0
      ? root.subCategories.map((s) => `    - [sub_id:${s.id}] ${s.name}`).join('\n')
      : '    (소분류 없음)';
    return `대분류 ${i + 1}. [id:${root.id}] ${root.name}\n${subs}`;
  }).join('\n');

  const prompt = `당신은 영수증 분석 전문가입니다. 첨부된 영수증 이미지를 분석하여 아래 JSON 형식으로 응답하세요.

거래 유형: ${transactionType === 'EXPENSE' ? '지출' : '수입'}

카테고리 목록:
${treeText || '(카테고리 없음)'}

지침:
1. 영수증에서 가맹점명 또는 품목명을 기반으로 "description"을 작성하세요 (예: "스타벅스 아메리카노").
2. 영수증의 최종 결제 금액(총액)을 "amount"에 숫자만 입력하세요 (예: 4500). 금액이 없으면 null.
3. 영수증에 포함된 모든 거래(구매) 날짜를 "dates" 배열에 "YYYY-MM-DD" 형식으로 입력하세요. 날짜가 없으면 빈 배열 [].
4. 카테고리 목록에서 가장 적합한 소분류를 선택하거나, 없으면 새 소분류 이름을 제안하세요.
5. existingSubId: 기존 소분류 sub_id(숫자) 또는 null
6. newSubName: 새 소분류 이름 또는 null (existingSubId가 null일 때만)
7. parentIndex: 대분류 번호 (1~${categories.length || 1} 사이 정수, 카테고리 없으면 null)

JSON 응답:
{
  "description": "<가맹점명 또는 품목 설명>",
  "amount": <결제 금액 숫자 또는 null>,
  "dates": ["<날짜1 YYYY-MM-DD>", "<날짜2 YYYY-MM-DD>"],
  "existingSubId": <기존 소분류 id 또는 null>,
  "newSubName": "<새 소분류 이름 또는 null>",
  "parentIndex": <대분류 번호 또는 null>
}`;

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
      max_tokens: 400,
      temperature: 0,
    });

    const raw = response.choices[0].message.content ?? '{}';
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
    const result = JSON.parse(jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : raw);

    const description: string = result.description ?? '';
    const amount: number | null = result.amount != null ? Number(result.amount) : null;
    const rawDates: unknown[] = Array.isArray(result.dates) ? result.dates : [];
    const dates: string[] = rawDates.filter(
      (d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
    );
    const dateStr: string | null = dates[0] ?? null;

    let categoryId: string | number | null = null;
    let categoryName: string | null = null;
    let parentId: string | number | null = null;
    let parentName: string | null = null;
    let isNew = false;

    if (categories.length > 0 && result.parentIndex != null) {
      const parentIndex = Number(result.parentIndex);
      if (Number.isInteger(parentIndex) && parentIndex >= 1 && parentIndex <= categories.length) {
        const parent = categories[parentIndex - 1];
        parentId = parent.id;
        parentName = parent.name;

        if (result.existingSubId != null) {
          const sub = parent.subCategories.find((s) => String(s.id) === String(result.existingSubId));
          if (sub) {
            categoryId = sub.id;
            categoryName = sub.name;
            isNew = false;
          }
        } else if (result.newSubName) {
          const subName = String(result.newSubName).trim();
          if (subName && subName !== parent.name.trim()) {
            categoryId = null;
            categoryName = subName;
            isNew = true;
          }
        }
      }
    }

    return NextResponse.json({ description, amount, date: dateStr, multipleDates: dates.length >= 2, categoryId, categoryName, parentId, parentName, isNew });
  } catch (e) {
    console.error('analyze-receipt error:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: '영수증 분석에 실패했습니다. 다시 시도해주세요.' }, { status: 500 });
  }
}
