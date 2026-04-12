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
 * billing_start_offset 의 특수 센티넬 값.
 * "결제 대상월의 전달 1일 ~ 말일" 청구 주기를 나타냅니다.
 */
export const PREV_MONTH_BILLING_SENTINEL = -99;

/**
 * 신용카드 공여기간 로직으로 실제 청구일(결제일)을 계산합니다.
 *
 * @param transactedAt       - 거래 발생일
 * @param settlementDay      - 카드 결제일 (1~31)
 * @param billingStartOffset - 결제일 기준 청구 시작 오프셋(일수, 보통 음수)
 *                             또는 PREV_MONTH_BILLING_SENTINEL(-99): 전달 1일~말일
 * @param billingEndOffset   - 결제일 기준 청구 마감 오프셋(일수). 센티넬 모드에서는 무시.
 */
export const calculateExpectedBillingDate = (
  transactedAt: Date,
  settlementDay: number,
  billingStartOffset: number = -30,
  billingEndOffset: number = 0,
): Date => {
  const tx = new Date(transactedAt);
  tx.setHours(0, 0, 0, 0);

  // 센티넬: 전달 1일 ~ 말일 청구 주기
  if (billingStartOffset === PREV_MONTH_BILLING_SENTINEL) {
    for (let monthOffset = 0; monthOffset <= 3; monthOffset++) {
      const settlementMonth = new Date(tx.getFullYear(), tx.getMonth() + monthOffset, 1);
      const settlement = clampToMonthEnd(
        settlementMonth.getFullYear(),
        settlementMonth.getMonth(),
        settlementDay,
      );
      // 청구 대상: 결제월의 전달 1일 ~ 말일
      const prevYear = settlementMonth.getMonth() === 0 ? settlementMonth.getFullYear() - 1 : settlementMonth.getFullYear();
      const prevMonth = settlementMonth.getMonth() === 0 ? 11 : settlementMonth.getMonth() - 1;
      const periodStart = new Date(prevYear, prevMonth, 1);
      const periodEnd = new Date(prevYear, prevMonth + 1, 0); // 말일

      if (tx >= periodStart && tx <= periodEnd) {
        return settlement;
      }
    }
    return clampToMonthEnd(tx.getFullYear(), tx.getMonth() + 1, settlementDay);
  }

  // 일반: 결제일 기준 오프셋
  for (let monthOffset = 0; monthOffset <= 3; monthOffset++) {
    const refDate = new Date(tx.getFullYear(), tx.getMonth() + monthOffset, 1);
    const settlement = clampToMonthEnd(refDate.getFullYear(), refDate.getMonth(), settlementDay);

    const periodStart = addDays(settlement, billingStartOffset);
    const periodEnd = addDays(settlement, billingEndOffset);

    if (tx >= periodStart && tx <= periodEnd) {
      return settlement;
    }
  }

  return clampToMonthEnd(tx.getFullYear(), tx.getMonth() + 1, settlementDay);
};
