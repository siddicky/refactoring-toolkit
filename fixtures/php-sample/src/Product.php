<?php

declare(strict_types=1);

namespace Acme\Billing;

use Acme\Billing\Pricing\DiscountPolicy;
use Acme\Billing\Support\Arrayable;
use Acme\Billing\Support\Taggable;

/**
 * A catalog product.
 */
final class Product implements Arrayable
{
    use Taggable;

    /** @var string */
    private $sku;

    /** @var string */
    private $name;

    /**
     * Unit price in cents. Prices are always integers in cents.
     */
    private $priceCents;

    /** @var string */
    private $currency;

    /** @var array<string, mixed>|null */
    private $metadata;

    public function __construct($sku, $name, $priceCents, $metadata = null, $currency = Money::DEFAULT_CURRENCY)
    {
        $this->sku = (string) $sku;
        $this->name = (string) $name;
        $this->priceCents = $priceCents;
        $this->currency = (string) $currency;
        $this->metadata = $metadata;
    }

    /**
     * Hydrates from a raw catalog row. Missing keys fall back to
     * sku='', name='', price_cents=0.
     */
    public static function fromArray(array $row)
    {
        $product = new self(
            $row['sku'] ?? '',
            $row['name'] ?? '',
            $row['price_cents'] ?? 0,
            $row['metadata'] ?? null,
            $row['currency'] ?? Money::DEFAULT_CURRENCY
        );

        foreach ((array) ($row['tags'] ?? []) as $tag) {
            $product->addTag($tag);
        }

        return $product;
    }

    public function sku()
    {
        return $this->sku;
    }

    public function name()
    {
        return $this->name;
    }

    public function currency()
    {
        return $this->currency;
    }

    public function metadata()
    {
        return $this->metadata;
    }

    /**
     * Unit price as a Money value in the product's currency.
     */
    public function price()
    {
        return new Money($this->priceCents / 100, $this->currency);
    }

    /**
     * True when this product costs strictly less than $other, which may be a
     * Product or a raw catalog row array.
     */
    public function cheaperThan($other)
    {
        if (is_array($other)) {
            $otherPrice = $other['price_cents'];
        } else {
            $otherPrice = $other->priceCents;
        }

        return $this->priceCents < $otherPrice;
    }

    public function discountedPrice(DiscountPolicy $policy, $units = 1)
    {
        return $policy->apply($this->price(), $units);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray()
    {
        return [
            'sku' => $this->sku,
            'name' => $this->name,
            'price_cents' => $this->priceCents,
            'currency' => $this->currency,
            'tags' => $this->tags(),
            'metadata' => $this->metadata,
        ];
    }
}
