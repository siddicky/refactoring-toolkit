<?php

declare(strict_types=1);

namespace Acme\Billing\Support;

interface Arrayable
{
    /**
     * @return array<string, mixed>
     */
    public function toArray();
}
