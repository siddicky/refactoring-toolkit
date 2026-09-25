<?php

declare(strict_types=1);

namespace Acme\Billing\Pricing;

use Acme\Billing\Money;

interface DiscountPolicy
{
    /**
     * Applies this policy to a subtotal for the given number of units.
     *
     * @param Money $subtotal
     * @param int   $units
     *
     * @return Money
     */
    public function apply(Money $subtotal, $units);
}
