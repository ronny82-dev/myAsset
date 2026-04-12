import { NextRequest, NextResponse } from 'next/server';
import { AzureOpenAI } from 'openai';

interface SubCategory { id: string | number; name: string; }
interface CategoryTree { id: string | number; name: string; subCategories: SubCategory[]; }

const EMPTY = { categoryId: null, categoryName: null, parentId: null, parentName: null, isNew: false };

export async function POST(req: NextRequest) {
  const { description, transactionType, categories } = await req.json() as {
    description: string;
    transactionType: 'EXPENSE' | 'INCOME';
    categories: CategoryTree[];
  };

  if (!description || description.trim().length < 2) {
    return NextResponse.json(EMPTY);
  }

  const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-02-01',
  });

  // 대분류를 번호로 매핑 (1-based)
  const treeText = categories.map((root, i) => {
    const subs = root.subCategories.length > 0
      ? root.subCategories.map((s) => `    - [sub_id:${s.id}] ${s.name}`).join('\n')
      : '    (소분류 없음)';
    return `대분류 ${i + 1}. ${root.name}\n${subs}`;
  }).join('\n');

  const prompt = `가계부 카테고리 분류 전문가입니다.
거래 유형: ${transactionType === 'EXPENSE' ? '지출' : '수입'}
적요: "${description}"

카테고리 목록:
${treeText}

지침:
1. 기존 소분류 중 적합한 것이 있으면 해당 sub_id를 반환하세요 (existingSubId).
2. 적합한 소분류가 없으면 적요("${description}")를 기반으로 구체적인 소분류 이름을 제안하세요 (newSubName).
3. 대분류는 소분류를 포괄할 수 있는 가장 넓고 적합한 상위 개념을 선택하세요 (parentIndex).
4. parentIndex는 반드시 1~${categories.length} 사이의 정수여야 합니다.
5. 소분류 이름은 선택한 대분류 이름과 달라야 하며, 대분류보다 더 구체적인 항목이어야 합니다.
6. 기존 소분류를 선택한 경우에도 해당 소분류가 속한 대분류 번호를 parentIndex에 입력하세요.

JSON 응답:
{
  "existingSubId": <기존 소분류 sub_id(숫자) 또는 null>,
  "newSubName": "<새 소분류 이름 또는 null>",
  "parentIndex": <1~${categories.length} 사이의 정수>
}`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 100,
      temperature: 0,
    });

    const result = JSON.parse(response.choices[0].message.content ?? '{}');

    // parentIndex 검증 (1-based, 범위 초과 시 거부)
    const parentIndex = Number(result.parentIndex);
    if (!Number.isInteger(parentIndex) || parentIndex < 1 || parentIndex > categories.length) {
      return NextResponse.json(EMPTY);
    }

    const parent = categories[parentIndex - 1];

    if (result.existingSubId != null) {
      // 기존 소분류: 해당 parent 안에서 탐색
      const sub = parent.subCategories.find((s) => String(s.id) === String(result.existingSubId));
      if (!sub) return NextResponse.json(EMPTY);
      return NextResponse.json({
        categoryId: sub.id,
        categoryName: sub.name,
        parentId: parent.id,
        parentName: parent.name,
        isNew: false,
      });
    }

    if (result.newSubName) {
      const subName = String(result.newSubName).trim();
      // 소분류 이름이 대분류 이름과 같으면 잘못된 분류 → 폐기
      if (subName === parent.name.trim()) return NextResponse.json(EMPTY);
      return NextResponse.json({
        categoryId: null,
        categoryName: subName,
        parentId: parent.id,
        parentName: parent.name,
        isNew: true,
      });
    }

    return NextResponse.json(EMPTY);
  } catch {
    return NextResponse.json(EMPTY);
  }
}
