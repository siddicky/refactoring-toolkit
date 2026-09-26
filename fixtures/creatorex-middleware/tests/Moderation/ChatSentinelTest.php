<?php

declare(strict_types=1);

namespace CreatorEx\Tests\Moderation;

use CreatorEx\Moderation\ChatSentinel;
use PHPUnit\Framework\TestCase;

final class ChatSentinelTest extends TestCase
{
    public function testBlocklistMatchesCaseInsensitively(): void
    {
        $sentinel = new ChatSentinel();

        $this->assertSame(['casino'], $sentinel->violations('Join our CASINO night'));
    }

    public function testSubstringMatchFlagsLegitWords(): void
    {
        $sentinel = new ChatSentinel();

        // 'crypto' matches inside longer words: pinned, not fixed.
        $this->assertSame(['crypto'], $sentinel->violations('Crypto news today'));
    }

    public function testLeetspeakEvadesTheBlocklist(): void
    {
        $sentinel = new ChatSentinel();

        $this->assertSame([], $sentinel->violations('fr33 m0ney for everyone'));
        $this->assertTrue($sentinel->isClean('fr33 m0ney for everyone'));
    }

    public function testRedactsEmails(): void
    {
        $sentinel = new ChatSentinel();

        $this->assertSame('contact [email] today', $sentinel->redact('contact creator@ex.com today'));
    }

    public function testRedactsFormattedPhoneNumbers(): void
    {
        $sentinel = new ChatSentinel();

        $this->assertSame('text [phone] please', $sentinel->redact('text +1 (555) 010-2030 please'));
    }

    public function testBareShortPhonesLeakThrough(): void
    {
        $sentinel = new ChatSentinel();

        // Seven digits are below the pattern's length threshold: no redaction.
        $this->assertSame('call 5550102 now', $sentinel->redact('call 5550102 now'));
    }

    public function testDatesAreMangledDespiteNoFalsePositivesPromise(): void
    {
        $sentinel = new ChatSentinel();

        $this->assertSame('premiere on [phone]!', $sentinel->redact('premiere on 2026-01-15!'));
    }

    public function testSnippetWindowIsLengthNotOffset(): void
    {
        $sentinel = new ChatSentinel();
        $text = 'ok casino ' . str_repeat('x', 60);

        // substr($text, -17, 23): a negative start counts from the end, and
        // the third argument is a length, not an end offset.
        $this->assertSame(str_repeat('x', 17), $sentinel->snippetAround($text, 'casino'));
        $this->assertSame('', $sentinel->snippetAround($text, 'crypto'));
    }
}
