<?php

declare(strict_types=1);

namespace Acme\Billing\Tests;

use Acme\Billing\Customer;
use Acme\Billing\Invoice;
use Acme\Billing\Product;
use PHPUnit\Framework\TestCase;

final class InvoiceTest extends TestCase
{
    private function customer(): Customer
    {
        return new Customer(['id' => 7, 'name' => 'Alice', 'email' => 'alice@example.com']);
    }

    private function product(): Product
    {
        return (new Product('SKU-9', 'Gadget', 1999))
            ->addTags('hardware', 'sale');
    }

    public function testSubtotalTaxAndTotal(): void
    {
        $invoice = new Invoice('INV-1', $this->customer(), 'USD', '10');
        $invoice->addLine(['product' => $this->product(), 'quantity' => 2]);

        $this->assertSame('39.98 USD', (string) $invoice->subtotal());
        $this->assertSame('4.00 USD', (string) $invoice->tax());
        $this->assertSame('43.98 USD', (string) $invoice->total());
    }

    public function testAddLineCoercesQuantityFromStrings(): void
    {
        $invoice = new Invoice('INV-2', $this->customer());
        $invoice->addLine(['product' => $this->product(), 'quantity' => '3']);

        $this->assertSame(1, $invoice->lineCount());
        $this->assertSame(3, $invoice->quantityForSku('SKU-9'));
    }

    public function testQuantityForSkuComparesLoosely(): void
    {
        $numericSkuProduct = new Product('9001', 'Legacy Part', 500);
        $invoice = new Invoice('INV-3', $this->customer());
        $invoice->addLine(['product' => $numericSkuProduct, 'quantity' => 2]);

        // '9001' == 9001 is true under PHP loose comparison.
        $this->assertSame(2, $invoice->quantityForSku(9001));
        $this->assertSame(0, $invoice->quantityForSku('9001 '));
    }

    public function testToStringRendersInvoice(): void
    {
        $invoice = new Invoice('INV-4', $this->customer());
        $invoice->addLine(['product' => $this->product(), 'quantity' => 1, 'note' => 'gift']);

        $rendered = (string) $invoice;

        $this->assertStringContainsString('Invoice INV-4 for Alice', $rendered);
        $this->assertStringContainsString('SKU-9 x1', $rendered);
    }

    public function testToArrayCarriesFormattedTotals(): void
    {
        $invoice = new Invoice('INV-5', $this->customer(), 'USD', '0');
        $invoice->addLines([
            ['product' => $this->product(), 'quantity' => 1],
        ]);

        $row = $invoice->toArray();

        $this->assertSame('19.99 USD', $row['total']);
        $this->assertSame(7, $row['customer_id']);
        $this->assertSame(['hardware', 'sale'], $row['tags']);
    }
}
