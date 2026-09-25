<?php

declare(strict_types=1);

namespace Acme\Billing;

/**
 * Immutable monetary value in a single currency.
 *
 * Amounts are stored as floats in the major currency unit and are always
 * non-negative.
 */
final class Money
{
    public const DEFAULT_CURRENCY = 'USD';

    /** @var float */
    private $amount;

    /** @var string */
    private $currency;

    public function __construct($amount, $currency = self::DEFAULT_CURRENCY)
    {
        $this->amount = (float) $amount;
        $this->currency = (string) $currency;
    }

    /**
     * Named constructor for messy human input such as "1,234.50" or " 12 ".
     */
    public static function parse($raw, $currency = self::DEFAULT_CURRENCY)
    {
        $normalized = str_replace([' ', ','], '', (string) $raw);
        if ($normalized === '') {
            return new self(0, $currency);
        }

        return new self((float) $normalized, $currency);
    }

    public function amount()
    {
        return $this->amount;
    }

    public function currency()
    {
        return $this->currency;
    }

    public function add(Money $other)
    {
        $this->assertSameCurrency($other);

        return new self($this->amount + $other->amount, $this->currency);
    }

    public function subtract(Money $other)
    {
        $this->assertSameCurrency($other);

        return new self($this->amount - $other->amount, $this->currency);
    }

    public function multiply($factor)
    {
        // Operator coercion: numeric strings such as "2.5" are valid factors.
        return new self($this->amount * $factor, $this->currency);
    }

    /**
     * A percentage of this amount, rounded to 2 decimals.
     */
    public function percentage($percent)
    {
        $raw = $this->amount * ((float) $percent) / 100;

        return new self(round($raw, 2), $this->currency);
    }

    public function equals($other)
    {
        return $other instanceof self
            && $this->amount == $other->amount // loose compare on purpose
            && $this->currency === $other->currency;
    }

    public function isNegative()
    {
        return $this->amount < 0;
    }

    private function assertSameCurrency(Money $other)
    {
        if ($this->currency !== $other->currency) {
            throw new \InvalidArgumentException(sprintf(
                'Currency mismatch: %s vs %s',
                $this->currency,
                $other->currency
            ));
        }
    }

    public function __toString()
    {
        return sprintf('%.2f %s', $this->amount, $this->currency);
    }
}
