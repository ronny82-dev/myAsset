function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function clampToMonthEnd(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

/**
 * 신용카드 공여기간 로직으로 실제 청구일(결제일)을 계산합니다.
 *
 * @param transactedAt      - 거래 발생일
 * @param settlementDay     - 카드 결제일 (1~31)
 * @param billingStartOffset - 결제일 기준 청구 시작 오프셋 (일수, 보통 음수)
 *                            예: -14 → 결제일 14일 전부터 청구 시작
 * @param billingEndOffset  - 결제일 기준 청구 마감 오프셋 (일수)
 *                            예: 0 → 결제일 당일까지 청구
 */
export const calculateExpectedBillingDate = (
  transactedAt: Date,
  settlementDay: number,
  billingStartOffset: number = -30,
  billingEndOffset: number = 0,
): Date => {
  const tx = new Date(transactedAt);
  tx.setHours(0, 0, 0, 0);

  // 현재 월부터 최대 3개월 앞까지 해당하는 청구 사이클을 찾는다
  for (let monthOffset = 0; monthOffset <= 3; monthOffset++) {
    const refDate = new Date(tx.getFullYear(), tx.getMonth() + monthOffset, 1);
    const settlement = clampToMonthEnd(refDate.getFullYear(), refDate.getMonth(), settlementDay);

    const periodStart = addDays(settlement, billingStartOffset);
    const periodEnd = addDays(settlement, billingEndOffset);

    if (tx >= periodStart && tx <= periodEnd) {
      return settlement;
    }
  }

  // fallback: 단순 다음달 결제일
  return clampToMonthEnd(tx.getFullYear(), tx.getMonth() + 1, settlementDay);
};
