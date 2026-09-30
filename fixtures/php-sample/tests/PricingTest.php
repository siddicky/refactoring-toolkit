<?php

declare(strict_types=1);

namespace Acme\Billing\Tests;

use Acme\Billing\Money;
use Acme\Billing\Product;
use Acme\Billing\Pricing\FlatRateDiscount;
use Acme\Billing\Pricing\PercentageDiscount;
use PHPUnit\Framework\TestCase;

final class PricingTest extends TestCase
{
    public function testPercentageDiscountFactoryReturnsOwnClass(): void
    {
        $policy = PercentageDiscount::of('20');

        $this->assertInstanceOf(PercentageDiscount::class, $policy);
        $this->assertSame(20.0, $policy->percent());
    }

    public function testPercentageDiscountAppliesToMultipliedBase(): void
    {
        $policy = PercentageDiscount::of(20);

        $this->assertSame('80.00 USD', (string) $policy->apply(new Money(50), 2));
    }

    public function testFlatRateDiscountDeductsPerUnit(): void
    {
        $policy = new FlatRateDiscount(new Money('3.50'));

        $this->assertSame('3.00 USD', (string) $policy->apply(new Money(10), 2));
    }

    public function testFlatRateDiscountFloorsAtZero(): void
    {
        $policy = new FlatRateDiscount(new Money('3.50'));

        $this->assertSame('0.00 USD', (string) $policy->apply(new Money(10), 3));
    }

    public function testProductDiscountedPriceUsesPolicy(): void
    {
        $product = new Product('SKU-1', 'Widget', 1999);
        $policy = PercentageDiscount::of(10);

        // 19.99 - 10% = 17.991, rounded to 17.99
        $this->assertSame('17.99 USD', (string) $product->discountedPrice($policy));
    }
}
