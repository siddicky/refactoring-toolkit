<?php

declare(strict_types=1);

namespace Acme\Billing\Tests;

use Acme\Billing\Money;
use PHPUnit\Framework\TestCase;

final class MoneyTest extends TestCase
{
    public function testAddsAmountsWithSameCurrency(): void
    {
        $a = new Money('12.50');
        $b = new Money(7.25);

        $this->assertSame('19.75 USD', (string) $a->add($b));
    }

    public function testParsesFormattedHumanInput(): void
    {
        $this->assertSame(1234.5, Money::parse('1,234.50')->amount());
        $this->assertSame(12.0, Money::parse(' 12 ')->amount());
    }

    public function testParseOfEmptyInputIsZero(): void
    {
        $this->assertSame(0.0, Money::parse('')->amount());
    }

    public function testMultiplyCoercesNumericStrings(): void
    {
        $this->assertSame('10.00 USD', (string) (new Money(4))->multiply('2.5'));
    }

    public function testEqualsComparesAmountsAfterFloatCoercion(): void
    {
        // The constructor casts both amounts to float, so 10 and '10.0' are
        // equal under == and under ===: the loose compare is not observable.
        $this->assertTrue((new Money(10))->equals(new Money('10.0')));
        $this->assertFalse((new Money(10, 'USD'))->equals(new Money(10, 'EUR')));
    }

    public function testSubtractMayGoNegative(): void
    {
        $result = (new Money(5))->subtract(new Money(8));

        $this->assertTrue($result->isNegative());
        $this->assertSame('-3.00 USD', (string) $result);
    }

    public function testPercentageRoundsToTwoDecimals(): void
    {
        $this->assertSame('10.13 USD', (string) (new Money(101.25))->percentage(10));
    }

    public function testRejectsCurrencyMismatch(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        (new Money(1, 'USD'))->add(new Money(1, 'EUR'));
    }
}
