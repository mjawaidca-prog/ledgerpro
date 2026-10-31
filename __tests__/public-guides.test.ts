import { existsSync } from 'fs';
import path from 'path';
import sitemap from '@/app/sitemap';
import { WALKTHROUGH_ARTICLES } from '@/lib/help-walkthroughs';
import { PUBLIC_GUIDES, PUBLIC_GUIDE_SLUGS, countGuideImages, getGuideUrl } from '@/lib/guides';
import { LEDGERPRO_URL } from '@/lib/seo';

describe('LedgerPro public SEO guides', () => {
  it('publishes exactly the ten detailed walkthroughs with unique public and source slugs', () => {
    expect(PUBLIC_GUIDES).toHaveLength(10);
    expect(new Set(PUBLIC_GUIDE_SLUGS).size).toBe(10);
    expect(new Set(PUBLIC_GUIDES.map((guide) => guide.sourceSlug)).size).toBe(10);

    const walkthroughSlugs = new Set(WALKTHROUGH_ARTICLES.map((article) => article.slug));
    for (const guide of PUBLIC_GUIDES) {
      expect(walkthroughSlugs.has(guide.sourceSlug)).toBe(true);
      expect(guide.article.slug).toBe(guide.sourceSlug);
      expect(guide.article.sections.length).toBeGreaterThan(0);
    }
  });

  it('gives every guide complete search metadata and three valid related guides', () => {
    const publicSlugs = new Set(PUBLIC_GUIDE_SLUGS);

    for (const guide of PUBLIC_GUIDES) {
      expect(guide.title.length).toBeGreaterThan(20);
      expect(guide.metaTitle).toContain('LedgerPro');
      expect(guide.description.length).toBeGreaterThanOrEqual(100);
      expect(guide.description.length).toBeLessThanOrEqual(220);
      expect(guide.intro.length).toBeGreaterThan(80);
      expect(guide.related).toHaveLength(3);
      expect(new Set(guide.related).size).toBe(3);
      expect(guide.related).not.toContain(guide.slug);
      for (const relatedSlug of guide.related) {
        expect(publicSlugs.has(relatedSlug)).toBe(true);
      }
    }
  });

  it('keeps the GST/HST guide as the highest-priority flagship', () => {
    const flagship = PUBLIC_GUIDES.find((guide) => guide.slug === 'gst-hst-return-lines-101-115');
    expect(flagship).toBeDefined();
    expect(flagship?.priority).toBe(Math.max(...PUBLIC_GUIDES.map((guide) => guide.priority)));
    expect(flagship?.article.slug).toBe('walkthrough-gst-return');
  });

  it('references all 38 screenshots and every referenced local image exists', () => {
    const totalImages = PUBLIC_GUIDES.reduce((total, guide) => total + countGuideImages(guide), 0);
    expect(totalImages).toBe(38);

    for (const guide of PUBLIC_GUIDES) {
      for (const section of guide.article.sections) {
        for (const image of section.images ?? []) {
          expect(image.alt.trim().length).toBeGreaterThan(10);
          expect(image.src).toMatch(/^\/help-images\//);
          expect(existsSync(path.join(process.cwd(), 'public', image.src))).toBe(true);
        }
      }
    }
  });

  it('adds the guide hub and every guide to the sitemap on the canonical domain', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(`${LEDGERPRO_URL}/guides`);
    for (const guide of PUBLIC_GUIDES) {
      expect(urls).toContain(getGuideUrl(guide));
      expect(getGuideUrl(guide)).toMatch(/^https:\/\/ledgerpro\.nexvarlab\.com\/guides\//);
    }
  });
});
