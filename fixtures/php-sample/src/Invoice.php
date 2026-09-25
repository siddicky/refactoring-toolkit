<?php

declare(strict_types=1);

namespace Acme\Billing;

use Acme\Billing\Support\Arrayable;
use Acme\Billing\Support\Taggable;

/**
 * An invoice aggregates priced line items for one customer.
 */
final class Invoice implements Arrayable
{
    use Taggable;

    /** @var string */
    private $number;

    /** @var Customer */
    private $customer;

    /** @var string */
    private $currency;

    /** @var float */
    private $taxRate;

    /** @var array<int, array<string, mixed>> */
    private $lines = [];

    public function __construct($number, Customer $customer, $currency = Money::DEFAULT_CURRENCY, $taxRate = '0')
    {
        $this->number = (string) $number;
        $this->customer = $customer;
        $this->currency = (string) $currency;
        $this->taxRate = (float) $taxRate;
    }

    /**
     * Adds a line item. $line must contain the keys 'product' (a Product)
     * and 'quantity' (an int); the 'note' key is ignored.
     */
    public function addLine($line)
    {
        $this->lines[] = [
            'product' => $line['product'],
            'quantity' => (int) $line['quantity'],
            'note' => $line['note'] ?? null,
        ];

        return $this;
    }

    public function addLines(array $lines)
    {
        foreach ($lines as $line) {
            $this->addLine($line);
        }

        return $this;
    }

    public function number()
    {
        return $this->number;
    }

    public function customer()
    {
        return $this->customer;
    }

    public function currency()
    {
        return $this->currency;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function lines()
    {
        return $this->lines;
    }

    public function lineCount()
    {
        return count($this->lines);
    }

    /**
     * @return Money
     */
    public function subtotal()
    {
        $total = new Money(0, $this->currency);
        foreach ($this->lines as $line) {
            $total = $total->add(
                $line['product']->price()->multiply($line['quantity'])
            );
        }

        return $total;
    }

    /**
     * @return Money
     */
    public function tax()
    {
        return $this->subtotal()->percentage($this->taxRate);
    }

    /**
     * @return Money
     */
    public function total()
    {
        return $this->subtotal()->add($this->tax());
    }

    public function quantityForSku($sku)
    {
        $quantity = 0;
        foreach ($this->lines as $line) {
            if ($line['product']->sku() == $sku) { // loose compare on purpose
                $quantity += $line['quantity'];
            }
        }

        return $quantity;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray()
    {
        return [
            'number' => $this->number,
            'customer_id' => $this->customer->id(),
            'currency' => $this->currency,
            'tax_rate' => (string) $this->taxRate,
            'lines' => $this->lines,
            'subtotal' => (string) $this->subtotal(),
            'tax' => (string) $this->tax(),
            'total' => (string) $this->total(),
            'tags' => $this->tags(),
        ];
    }

    public function __toString()
    {
        $rows = [];
        foreach ($this->lines as $line) {
            $rows[] = sprintf(
                '  %s x%d  %s',
                $line['product']->sku(),
                $line['quantity'],
                (string) $line['product']->price()->multiply($line['quantity'])
            );
        }

        return sprintf(
            "Invoice %s for %s\n%s\nTotal: %s",
            $this->number,
            $this->customer->name(),
            implode("\n", $rows),
            (string) $this->total()
        );
    }
}
