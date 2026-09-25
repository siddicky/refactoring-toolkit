<?php

declare(strict_types=1);

namespace Acme\Billing\Support;

/**
 * Reusable tag bookkeeping.
 *
 * Tags are always flat strings once stored, and merging is only meaningful
 * between entities of the same class.
 */
trait Taggable
{
    /** @var array<int, string> */
    private $tags = [];

    public function addTag($tag)
    {
        $this->tags[] = (string) $tag;

        return $this;
    }

    public function addTags(...$tags)
    {
        foreach ($tags as $tag) {
            $this->addTag($tag);
        }

        return $this;
    }

    /**
     * @return array<int, string>
     */
    public function tags()
    {
        return $this->tags;
    }

    public function hasTag($tag)
    {
        return in_array((string) $tag, $this->tags, true);
    }

    /**
     * Merges tags from another entity, which must expose tags().
     */
    public function mergeTagsFrom($other)
    {
        foreach ($other->tags() as $tag) {
            if (!$this->hasTag($tag)) {
                $this->addTag($tag);
            }
        }

        return $this;
    }
}
