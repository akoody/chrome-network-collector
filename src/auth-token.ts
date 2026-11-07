import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Сравнение токена за постоянное время. Хэши выравнивают длину, поэтому
 * по времени ответа нельзя подобрать ни значение, ни длину токена.
 */
export function tokenMatches(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return false;
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}
