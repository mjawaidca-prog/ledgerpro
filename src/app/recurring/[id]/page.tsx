'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, Plus, Trash2, Save, Loader2 } from 'lucide-react';

export default function RecurringEditorPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const isNew = params.id === 'new';
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [nextPostDate, setNextPostDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [active, setActive] = useState(true);
  const [lines, setLines] = useState<{ glAccountCode: string; description: string; debit: number; credit: number }[]>([
    { glAccountCode: '', description: '', debit: 0, credit: 0 },
    { glAccountCode: '', description: '', debit: 0, credit: 0 },
  ]);
  const [coa, setCoa] = useState<any[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/coa').then(r => r.json()).then(j => setCoa(j.data || [])).catch(() => {});
    if (!isNew) {
      fetch(`/api/recurring/${params.id}`).then(r => r.json()).then(j => {
        const t = j.data; if (!t) return;
        setName(t.name); setDescription(t.description || ''); setFrequency(t.frequency);
        setNextPostDate(new Date(t.nextPostDate).toISOString().slice(0, 10));
        setEndDate(t.endDate ? new Date(t.endDate).toISOString().slice(0, 10) : '');
        setActive(t.active);
        setLines(t.lines?.map((l: any) => ({ glAccountCode: l.glAccountCode, description: l.description || '', debit: Number(l.debit), credit: Number(l.credit) })) || []);
      }).catch(() => {}).finally(() => setLoading(false));
    }
  }, [isNew, params.id]);

  async function handleSave() {
    if (!name) return alert('Name is required');
    setSaving(true);
    const payload = { name, description, frequency, nextPostDate: nextPostDate ? new Date(nextPostDate).toISOString() : null, endDate: endDate || null, active, lines };
    const url = isNew ? '/api/recurring' : `/api/recurring/${params.id}`;
    const method = isNew ? 'POST' : 'PUT';
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      router.push('/recurring');
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  }

  if (loading) return <AppShell><div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin" /></div></AppShell>;

  return (
    <AppShell>
      <div className="max-w-2xl">
        <div className="content-head">
          <button onClick={() => router.push('/recurring')} className="p-2 rounded-lg hover:bg-[var(--surface-3)] mr-3"><ArrowLeft size={18} /></button>
          <div><h1 className="greet">{isNew ? 'New Recurring Template' : 'Edit Template'}</h1></div>
        </div>

        <Card className="mb-6"><CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="field"><label>Template Name *</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Monthly Rent" /></div>
            <div className="field"><label>Frequency</label><select className="input" value={frequency} onChange={e => setFrequency(e.target.value)}>{[
              { v: 'weekly', l: 'Weekly' }, { v: 'monthly', l: 'Monthly' }, { v: 'quarterly', l: 'Quarterly' }, { v: 'annual', l: 'Annual' },
            ].map(f => <option key={f.v} value={f.v}>{f.l}</option>)}</select></div>
          </div>
          <div className="field"><label>Description</label><input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Office rent payment" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="field"><label>Next Post Date *</label><input type="date" className="input" value={nextPostDate} onChange={e => setNextPostDate(e.target.value)} /></div>
            <div className="field"><label>End Date (optional)</label><input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
          </div>
        </CardBody></Card>

        <Card className="mb-6">
          <CardHeader><div className="flex items-center justify-between w-full"><h3 className="t-h3">Journal Lines</h3><Button variant="ghost" size="sm" onClick={() => setLines([...lines, { glAccountCode: '', description: '', debit: 0, credit: 0 }])}><Plus size={14} /> Add Line</Button></div></CardHeader>
          <CardBody>
            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className="input flex-1" value={l.glAccountCode} onChange={e => { const nl = [...lines]; nl[i].glAccountCode = e.target.value; setLines(nl); }}>
                    <option value="">Select account...</option>
                    {coa.map(a => <option key={a.id} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                  <input className="input w-[100px]" placeholder="Desc" value={l.description} onChange={e => { const nl = [...lines]; nl[i].description = e.target.value; setLines(nl); }} />
                  <input type="number" className="input w-[120px]" placeholder="Debit" value={l.debit || ''} onChange={e => { const nl = [...lines]; nl[i].debit = parseFloat(e.target.value) || 0; nl[i].credit = 0; setLines(nl); }} />
                  <input type="number" className="input w-[120px]" placeholder="Credit" value={l.credit || ''} onChange={e => { const nl = [...lines]; nl[i].credit = parseFloat(e.target.value) || 0; nl[i].debit = 0; setLines(nl); }} />
                  {lines.length > 2 && <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-[var(--danger)]"><Trash2 size={14} /></button>}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Button onClick={handleSave} disabled={saving} className="w-full" size="lg">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Template
        </Button>
      </div>
    </AppShell>
  );
}
