<?php

declare(strict_types=1);

namespace Acme\Billing\Tests;

use Acme\Billing\Customer;
use Acme\Billing\Invoice;
use Acme\Billing\InvoiceRepository;
use Acme\Billing\Product;
use PHPUnit\Framework\TestCase;

final class InvoiceRepositoryTest extends TestCase
{
    private function invoice($number, $customerId, $priceCents, $currency = 'USD')
    {
        $product = new Product('SKU-1', 'Widget', $priceCents, null, $currency);
        $customer = new Customer(['id' => $customerId, 'name' => 'Bob']);

        return (new Invoice($number, $customer, $currency))->addLine([
            'product' => $product,
            'quantity' => 1,
        ]);
    }

    public function testSaveAndFindRoundTrip(): void
    {
        $repo = new InvoiceRepository();

        $repo->save($this->invoice('INV-1', 7, 1999), '2026-01-15T10:30:00Z');
        $found = $repo->find('INV-1');

        $this->assertInstanceOf(Invoice::class, $found);
        $this->assertSame('19.99 USD', (string) $found->total());
        $this->assertSame(1, $found->quantityForSku('SKU-1'));
    }

    public function testHydrationLosesCustomerName(): void
    {
        $repo = new InvoiceRepository();
        $repo->save($this->invoice('INV-1', 7, 1999));

        $found = $repo->find('INV-1');

        // Storage rows carry no customer name, so hydration falls back.
        $this->assertSame('unknown', $found->customer()->name());
    }

    public function testFindMissingInvoiceReturnsNull(): void
    {
        $repo = new InvoiceRepository();

        $this->assertNull($repo->find('NOPE'));
    }

    public function testDeleteRemovesTheRow(): void
    {
        $repo = new InvoiceRepository();
        $repo->save($this->invoice('INV-1', 1, 1999));

        $repo->delete('INV-1');

        $this->assertCount(0, $repo);
        $this->assertNull($repo->find('INV-1'));
    }

    public function testAllIsKeyedByInvoiceNumber(): void
    {
        $repo = new InvoiceRepository();
        $repo->save($this->invoice('INV-1', 1, 1999));
        $repo->save($this->invoice('INV-2', 2, 2500));

        $this->assertSame(['INV-1', 'INV-2'], array_keys($repo->all()));
    }

    public function testTotalByCurrencySumsFormattedStringTotals(): void
    {
        $repo = new InvoiceRepository();
        $repo->save($this->invoice('INV-1', 1, 1999));       // "19.99 USD"
        $repo->save($this->invoice('INV-2', 1, 2500));       // "25.00 USD"
        $repo->save($this->invoice('INV-3', 2, 999, 'EUR')); // "9.99 EUR"

        $totals = $repo->totalByCurrency();

        $this->assertSame(['USD', 'EUR'], array_keys($totals));
        $this->assertEqualsWithDelta(44.99, $totals['USD'], 0.0001);
        $this->assertEqualsWithDelta(9.99, $totals['EUR'], 0.0001);
    }

    public function testIsCountable(): void
    {
        $repo = new InvoiceRepository();
        $repo->save($this->invoice('INV-1', 1, 1999));

        $this->assertCount(1, $repo);
    }
}
