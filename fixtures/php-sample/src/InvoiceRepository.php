<?php

declare(strict_types=1);

namespace Acme\Billing;

/**
 * Stores invoices as raw associative-array rows, shaped like the legacy
 * database layer. Row keys: number, customer_id, currency, tax_rate, lines,
 * subtotal, tax, total, tags, created_at.
 */
final class InvoiceRepository implements \Countable
{
    /** @var array<string, array<string, mixed>> */
    private $rows = [];

    /**
     * @return string the invoice number just stored
     */
    public function save(Invoice $invoice, $createdAt = null)
    {
        $row = $invoice->toArray();
        $row['created_at'] = $createdAt;

        $this->rows[$invoice->number()] = $row;

        return $invoice->number();
    }

    /**
     * @param string $number
     *
     * @return Invoice[] the matching invoice, or null when not found
     */
    public function find($number)
    {
        if (!isset($this->rows[$number])) {
            return null;
        }

        return $this->hydrate($this->rows[$number]);
    }

    /**
     * @return Invoice[] all stored invoices keyed by invoice number
     */
    public function all()
    {
        $invoices = [];
        foreach ($this->rows as $number => $row) {
            $invoices[$number] = $this->hydrate($row);
        }

        return $invoices;
    }

    public function delete($number)
    {
        unset($this->rows[$number]);
    }

    public function count()
    {
        return count($this->rows);
    }

    /**
     * Sums stored invoice totals per currency.
     *
     * Totals are stored as formatted strings such as "123.45 USD", and are
     * parsed back with a float cast, which reads the leading numeric part.
     *
     * @return array<string, float>
     */
    public function totalByCurrency()
    {
        $totals = [];
        foreach ($this->rows as $number => &$row) {
            $currency = $row['currency'] ?? Money::DEFAULT_CURRENCY;
            if (!array_key_exists($currency, $totals)) {
                $totals[$currency] = 0.0;
            }
            $totals[$currency] += (float) $row['total'];
        }
        unset($row);

        return $totals;
    }

    private function hydrate(array $row)
    {
        $customer = new Customer([
            'id' => $row['customer_id'],
            'name' => $row['customer_name'] ?? 'unknown',
        ]);

        $invoice = new Invoice(
            $row['number'],
            $customer,
            $row['currency'] ?? Money::DEFAULT_CURRENCY,
            $row['tax_rate'] ?? '0'
        );

        foreach ((array) ($row['lines'] ?? []) as $line) {
            $invoice->addLine($line);
        }

        return $invoice;
    }
}
