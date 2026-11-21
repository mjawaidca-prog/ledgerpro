import { HELP_ARTICLES, HELP_CATEGORIES } from '@/lib/help-content';

describe('LedgerPro help content', () => {
  it('publishes the complete manual topic set with unique slugs', () => {
    expect(HELP_ARTICLES).toHaveLength(57);
    expect(new Set(HELP_ARTICLES.map((article) => article.slug)).size).toBe(57);
  });

  it('covers the November 2026 improvement-plan features', () => {
    const newSlugs = [
      'loans-and-interest',
      'loan-statement-capture',
      'fixed-assets-cca-register',
      'cca-write-back',
      'calculator',
      'gst-hst-worksheet',
      'year-end-package',
      'ai-categorization',
      'receipt-reading-draft-bills',
      'gifi-coding',
      'industry-chart-templates',
      'books-health',
      'reconciliation-assistant',
      'cash-flow-outlook',
      'ask-your-books',
    ];
    const bySlug = new Map(HELP_ARTICLES.map((article) => [article.slug, article]));
    for (const slug of newSlugs) {
      const article = bySlug.get(slug);
      expect(article).toBeDefined();
      expect(article!.sections.length).toBeGreaterThan(0);
      expect(article!.summary.length).toBeGreaterThan(0);
      expect(article!.keywords.length).toBeGreaterThan(0);
      for (const section of article!.sections) {
        const body = (section.text ?? '').length
          + (section.steps ?? []).join('').length
          + (section.notes ?? []).join('').length;
        expect(body).toBeGreaterThan(0);
      }
      if (article!.action) {
        expect(article!.action.href.startsWith('/')).toBe(true);
      }
    }
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
