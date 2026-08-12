'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, Trash2, UserPlus } from '@/components/icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, formatRelativeTime, humanize } from '@/lib/format';

const ROLE_HINTS: Record<string, string> = {
  OWNER: 'Full control, including billing',
  ADMIN: 'Manage everything except billing',
  OPERATOR: 'Run automations, review records, sync outputs',
  VIEWER: 'Read-only access',
};

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  lastLoginAt: string | null;
  joinedAt: string;
}

export function TeamTable({
  members,
  canManage,
  currentUserId,
}: {
  members: Member[];
  canManage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('OPERATOR');
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function invite() {
    setBusy('invite');
    try {
      const response = await fetch('/api/team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name: name || undefined, role }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not add that member.');

      if (body.data.temporaryPassword) {
        setTempPassword(body.data.temporaryPassword);
        toast.success('Member added', { description: 'Share the temporary password with them securely.' });
      } else {
        toast.success('Member added', { description: 'They can sign in with their existing password.' });
        setOpen(false);
      }
      setEmail('');
      setName('');
      router.refresh();
    } catch (err) {
      toast.error('Could not add member', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(membershipId: string, nextRole: string) {
    setBusy(membershipId);
    try {
      const response = await fetch('/api/team', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ membershipId, role: nextRole }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not change the role.');
      toast.success('Role updated');
      router.refresh();
    } catch (err) {
      toast.error('Could not change role', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  }

  async function remove(member: Member) {
    if (!confirm(`Remove ${member.name} from this workspace?`)) return;
    setBusy(member.id);
    try {
      const response = await fetch(`/api/team?id=${member.id}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not remove that member.');
      toast.success('Member removed');
      router.refresh();
    } catch (err) {
      toast.error('Could not remove member', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {canManage ? (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setOpen(true)}>
            <UserPlus className="h-4 w-4" /> Add member
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Last sign-in</TableHead>
                <TableHead className="hidden md:table-cell">Joined</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="font-medium">
                      {member.name}
                      {member.userId === currentUserId ? (
                        <Badge variant="muted" className="ml-2">
                          You
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{member.email}</div>
                  </TableCell>
                  <TableCell>
                    {canManage && member.userId !== currentUserId ? (
                      <Select
                        value={member.role}
                        onValueChange={(v) => changeRole(member.id, v)}
                        disabled={busy === member.id}
                      >
                        <SelectTrigger className="h-8 w-auto min-w-[8rem]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'].map((r) => (
                            <SelectItem key={r} value={r}>
                              {humanize(r)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div>
                        <Badge variant="secondary">{humanize(member.role)}</Badge>
                        <p className="mt-0.5 text-xs text-muted-foreground">{ROLE_HINTS[member.role]}</p>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                    {formatRelativeTime(member.lastLoginAt)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {formatDate(member.joinedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && member.userId !== currentUserId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove(member)}
                        disabled={busy === member.id}
                        aria-label={`Remove ${member.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTempPassword(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a team member</DialogTitle>
            <DialogDescription>
              MsgFlow accounts use an email and password you control — no third-party sign-in.
            </DialogDescription>
          </DialogHeader>

          {tempPassword ? (
            <div className="space-y-3">
              <div className="rounded-md border border-success/30 bg-success/10 p-3">
                <p className="text-sm font-medium text-success">Account created</p>
                <p className="mt-1 text-sm text-success/90">
                  Share this temporary password securely. They should change it after signing in.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input readOnly value={tempPassword} className="font-mono" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(tempPassword);
                    toast.success('Copied');
                  }}
                  aria-label="Copy password"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="member-email">Email</Label>
                <Input
                  id="member-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@company.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="member-name">Name (optional)</Label>
                <Input id="member-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['ADMIN', 'OPERATOR', 'VIEWER'].map((r) => (
                      <SelectItem key={r} value={r}>
                        {humanize(r)} — {ROLE_HINTS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            {tempPassword ? (
              <Button onClick={() => { setOpen(false); setTempPassword(null); }}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={invite} loading={busy === 'invite'} disabled={!email}>
                  Add member
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
