/**
 * Raw `tsc --noEmit --pretty false` sample outputs used as test fixtures.
 * This module is the only copy; tsc-queue.test.ts imports the constants.
 */

export const TSC_SAMPLE_1 = `src/services/user-service.ts(12,3): error TS2304: Cannot find name 'mysqli_query'.
src/services/user-service.ts(20,10): error TS2345: Argument of type 'string | null' is not assignable to parameter of type 'string'.
  Types of parameters 'email' and 'email' are incompatible.
    Type 'null' is not assignable to type 'string'.
src/repositories/user-repository.ts(5,1): error TS2304: Cannot find name 'PDO'.
src/repositories/user-repository.ts(31,9): error TS2551: Property 'fetch_all' does not exist on type 'UserRow[]'. Did you mean 'flatMap'?
Found 4 errors in 2 files.
`;

export const TSC_SAMPLE_2 = `src/pricing/discount.ts(8,15): error TS7006: Parameter 'rate' implicitly has an 'any' type.
src/pricing/discount.ts(15,5): error TS2322: Type 'null' is not assignable to type 'number'.
src/pricing/discount.ts(22,10): error TS7006: Parameter 'items' implicitly has an 'any' type.
tests/discount.test.ts(4,20): error TS7006: Parameter 'calc' implicitly has an 'any' type.
src/pricing/tax.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.
`;

export const TSC_SAMPLE_3 = `src/models/order.ts(47,25): error TS18048: 'orders' is possibly 'undefined'.
`;
