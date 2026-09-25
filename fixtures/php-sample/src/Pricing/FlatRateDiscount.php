<?php

declare(strict_types=1);

namespace Acme\Billing\Pricing;

use Acme\Billing\Money;

/**
 * Subtracts a flat amount per unit, floored at zero.
 */
final class FlatRateDiscount implements DiscountPolicy
{
    /** @var Money */
    private $amountPerUnit;

    public function __construct(Money $amountPerUnit)
    {
        $this->amountPerUnit = $amountPerUnit;
    }

    public function apply(Money $subtotal, $units = 1)
    {
        $deduction = $this->amountPerUnit->multiply((int) $units);
        $result = $subtotal->subtract($deduction);

        if ($result->isNegative()) {
            return new Money(0, $subtotal->currency());
        }

        return $result;
    }
}
