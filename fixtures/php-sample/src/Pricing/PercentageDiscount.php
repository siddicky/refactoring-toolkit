<?php

declare(strict_types=1);

namespace Acme\Billing\Pricing;

use Acme\Billing\Money;

/**
 * Reduces a subtotal by a percentage.
 */
final class PercentageDiscount implements DiscountPolicy
{
    /** @var float */
    private $percent;

    public function __construct($percent)
    {
        $this->percent = (float) $percent;
    }

    /**
     * Fluent constructor written with late static binding so that
     * subclasses resolve to their own class.
     */
    public static function of($percent)
    {
        return new static($percent);
    }

    public function apply(Money $subtotal, $units = 1)
    {
        $base = $subtotal->multiply($units);

        return $base->subtract($base->percentage($this->percent));
    }

    public function percent()
    {
        return $this->percent;
    }
}
