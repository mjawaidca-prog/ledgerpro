import { HELP_ARTICLES, HELP_CATEGORIES } from '@/lib/help-content';

describe('LedgerPro help content', () => {
  it('publishes the complete manual topic set with unique slugs', () => {
    expect(HELP_ARTICLES).toHaveLength(23);
    expect(new Set(HELP_ARTICLES.map((article) => article.slug)).size).toBe(23);
  });

  it('assigns every article to a visible category', () => {
    const categories = new Set<string>(HELP_CATEGORIES);
    for (const article of HELP_ARTICLES) {
      expect(categories.has(article.category)).toBe(true);
      expect(article.sections.length).toBeGreaterThan(0);
    }
  });

  it('contains the important product boundaries', () => {
    const boundaries = HELP_ARTICLES.find((article) => article.slug === 'product-boundaries-and-faq');
    const content = JSON.stringify(boundaries).toLowerCase();
    expect(content).toContain('automatic bank feeds');
    expect(content).toContain('public third-party api');
    expect(content).toContain('payroll processing');
    expect(content).toContain('tax-authority payment');
  });
});
