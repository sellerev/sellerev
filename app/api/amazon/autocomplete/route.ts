import { NextRequest, NextResponse } from 'next/server';

// In-memory cache: Map<prefix, { suggestions: string[], timestamp: number }>
const cache = new Map<string, { suggestions: string[]; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface AmazonCompletionResponse {
  suggestions?: Array<{
    value?: string;
    type?: string;
  }>;
  alias?: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    // Validate query parameter
    if (!query || typeof query !== 'string') {
      return NextResponse.json([]);
    }

    const prefix = query.trim();

    // Return empty array if query is too short
    if (prefix.length < 2) {
      return NextResponse.json([]);
    }

    // Check cache
    const cached = cache.get(prefix);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < CACHE_TTL_MS) {
        return NextResponse.json(cached.suggestions);
      }
      // Cache expired, remove it
      cache.delete(prefix);
    }

    // Fetch from Amazon completion endpoint
    const amazonUrl = new URL('https://completion.amazon.com/api/2017/suggestions');
    amazonUrl.searchParams.set('alias', 'aps');
    amazonUrl.searchParams.set('mid', 'ATVPDKIKX0DER');
    amazonUrl.searchParams.set('prefix', prefix);

    const response = await fetch(amazonUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      // Fail silently - return empty array
      return NextResponse.json([]);
    }

    const data: any = await response.json();

    // Parse keyword suggestions only
    // Amazon completion API can return different formats:
    // 1. { suggestions: [{ value: "keyword" }] }
    // 2. { suggestions: ["keyword1", "keyword2"] }
    // 3. Direct array of strings
    const suggestions: string[] = [];
    
    if (Array.isArray(data)) {
      // Direct array format
      for (const item of data) {
        if (typeof item === 'string' && item.trim()) {
          suggestions.push(item.trim());
        } else if (item && typeof item === 'object' && item.value && typeof item.value === 'string' && item.value.trim()) {
          suggestions.push(item.value.trim());
        }
      }
    } else if (data && typeof data === 'object') {
      // Object with suggestions array
      if (Array.isArray(data.suggestions)) {
        for (const item of data.suggestions) {
          if (typeof item === 'string' && item.trim()) {
            suggestions.push(item.trim());
          } else if (item && typeof item === 'object' && item.value && typeof item.value === 'string' && item.value.trim()) {
            suggestions.push(item.value.trim());
          }
        }
      }
    }

    // Limit to 6 suggestions (though we'll limit on frontend too)
    const limitedSuggestions = suggestions.slice(0, 6);

    // Cache results
    cache.set(prefix, {
      suggestions: limitedSuggestions,
      timestamp: Date.now(),
    });

    return NextResponse.json(limitedSuggestions);
  } catch (error) {
    // Fail silently - return empty array
    return NextResponse.json([]);
  }
}
