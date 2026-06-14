/**
 * CIS tax month: 6th of month to 5th of next month.
 * Payments on 1st–5th belong to the PREVIOUS month's period.
 * Payments on 6th+ belong to the CURRENT month's period.
 */
export function calcTaxMonth(paymentDate: Date): string {
  const day   = paymentDate.getDate();
  const month = paymentDate.getMonth(); // 0-indexed
  const year  = paymentDate.getFullYear();

  if (day <= 5) {
    const taxMonth = month === 0 ? 11 : month - 1;
    const taxYear  = month === 0 ? year - 1 : year;
    return `${taxYear}-${String(taxMonth + 1).padStart(2, '0')}`;
  }
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** CIS deduction applies to labour ONLY — never to materials, VAT, or equipment. */
export function calcCisDeduction(labourPence: number, deductionRate: number): number {
  return Math.round(labourPence * (deductionRate / 100));
}

export function calcNetPayment(
  labourPence:    number,
  materialsPence: number,
  vatPence:       number,
  equipmentPence: number,
  deductionPence: number,
): number {
  const gross = labourPence + materialsPence + vatPence + equipmentPence;
  return gross - deductionPence;
}
