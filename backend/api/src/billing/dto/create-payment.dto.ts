import { IsIn, IsInt, Max, Min } from 'class-validator';

export const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER'] as const;

export class CreatePaymentDto {
  // Whole minor units (paisa), never decimals
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  amount: number;

  @IsIn(PAYMENT_METHODS)
  method: (typeof PAYMENT_METHODS)[number];
}