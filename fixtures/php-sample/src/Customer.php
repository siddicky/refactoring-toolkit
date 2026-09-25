<?php

declare(strict_types=1);

namespace Acme\Billing;

/**
 * A billing customer hydrated from storage rows.
 *
 * Storage rows are plain associative arrays; unknown keys are preserved and
 * reachable through the magic property accessors.
 */
final class Customer
{
    /** @var array<string, mixed> */
    private $attributes;

    public function __construct(array $attributes = [])
    {
        $defaults = [
            'id' => null,
            'name' => '',
            'email' => null,
            'vat_number' => null,
            'credit_limit' => '0.00',
        ];

        $this->attributes = array_merge($defaults, $attributes);
    }

    public static function fromArray(array $row)
    {
        return new self($row);
    }

    public function id()
    {
        return $this->attributes['id'];
    }

    public function name()
    {
        return $this->attributes['name'];
    }

    /**
     * Credit limit is stored as a numeric string. Returns null when the
     * customer has no limit configured.
     */
    public function creditLimit()
    {
        $limit = $this->attributes['credit_limit'];

        return $limit === null ? null : Money::parse($limit);
    }

    public function hasCreditFor(Money $requested)
    {
        $limit = $this->creditLimit();
        if ($limit === null) {
            return true;
        }

        return $limit->amount() >= $requested->amount();
    }

    public function __get($name)
    {
        if (array_key_exists($name, $this->attributes)) {
            return $this->attributes[$name];
        }

        trigger_error(sprintf('Undefined property: Customer::$%s', $name), E_USER_NOTICE);

        return null;
    }

    public function __isset($name)
    {
        return isset($this->attributes[$name]);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray()
    {
        return $this->attributes;
    }
}
