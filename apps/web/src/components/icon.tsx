import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Material Symbols (Rounded) rendered as ligature text.
 *
 * The icon glyph is sized by `font-size`, but the codebase sizes icons with
 * Tailwind box utilities (`h-4 w-4`, `h-3.5 w-3.5`, `size-5`). We read that
 * class off `className` and mirror it into `font-size` so the glyph fills the
 * box it was given. An explicit `size` prop (px) always wins.
 */
const BOX_CLASS = /(?:^|\s)(?:h|size)-(\d+(?:\.\d+)?)(?:\s|$)/;

function resolveSize(className?: string, size?: number): string {
  if (typeof size === 'number') return `${size}px`;
  const match = className?.match(BOX_CLASS);
  if (match) return `${parseFloat(match[1]) * 0.25}rem`;
  return '1.25rem';
}

export type IconProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> & {
  /** Material Symbols ligature name, e.g. `check_circle`. */
  name: string;
  /** Explicit pixel size; otherwise derived from the `h-*`/`size-*` class. */
  size?: number;
  /** Render the filled variant. */
  filled?: boolean;
  /** Accepted for drop-in compatibility with the previous icon set; ignored. */
  strokeWidth?: number;
};

export function Icon({
  name,
  size,
  filled = false,
  className,
  style,
  strokeWidth: _strokeWidth,
  ...rest
}: IconProps) {
  const fontSize = resolveSize(className, size);
  return (
    <span
      aria-hidden={rest['aria-label'] ? undefined : true}
      translate="no"
      {...rest}
      className={cn('material-symbols-rounded msf-icon', className)}
      style={{
        fontSize,
        width: fontSize,
        height: fontSize,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
        ...style,
      }}
    >
      {name}
    </span>
  );
}

export type SymbolProps = Omit<IconProps, 'name'>;

function symbol(name: string, displayName: string) {
  const Component = (props: SymbolProps) => <Icon name={name} {...props} />;
  Component.displayName = displayName;
  return Component;
}

/* Named exports mirror the icon names used throughout the app. */
export const Activity = symbol('monitoring', 'Activity');
export const AlertCircle = symbol('error', 'AlertCircle');
export const AlertOctagon = symbol('report', 'AlertOctagon');
export const AlertTriangle = symbol('warning', 'AlertTriangle');
export const ArrowLeft = symbol('arrow_back', 'ArrowLeft');
export const ArrowRight = symbol('arrow_forward', 'ArrowRight');
export const Ban = symbol('block', 'Ban');
export const BarChart3 = symbol('bar_chart', 'BarChart3');
export const Bell = symbol('notifications', 'Bell');
export const Building2 = symbol('apartment', 'Building2');
export const CalendarRange = symbol('date_range', 'CalendarRange');
export const Check = symbol('check', 'Check');
export const CheckCircle2 = symbol('check_circle', 'CheckCircle2');
export const CheckSquare = symbol('check_box', 'CheckSquare');
export const ChevronDown = symbol('expand_more', 'ChevronDown');
export const ChevronLeft = symbol('chevron_left', 'ChevronLeft');
export const ChevronRight = symbol('chevron_right', 'ChevronRight');
export const Clock = symbol('schedule', 'Clock');
export const Copy = symbol('content_copy', 'Copy');
export const CreditCard = symbol('credit_card', 'CreditCard');
export const Database = symbol('database', 'Database');
export const Download = symbol('download', 'Download');
export const EyeOff = symbol('visibility_off', 'EyeOff');
export const FileDown = symbol('file_download', 'FileDown');
export const FileOutput = symbol('output', 'FileOutput');
export const FileQuestion = symbol('help_center', 'FileQuestion');
export const FileSpreadsheet = symbol('table_chart', 'FileSpreadsheet');
export const FileStack = symbol('file_copy', 'FileStack');
export const FileText = symbol('description', 'FileText');
export const Gauge = symbol('speed', 'Gauge');
export const Globe = symbol('public', 'Globe');
export const History = symbol('history', 'History');
export const Inbox = symbol('inbox', 'Inbox');
export const KeyRound = symbol('key', 'KeyRound');
export const LayoutDashboard = symbol('dashboard', 'LayoutDashboard');
export const Loader2 = symbol('progress_activity', 'Loader2');
export const LogOut = symbol('logout', 'LogOut');
export const Menu = symbol('menu', 'Menu');
export const MessageSquare = symbol('chat', 'MessageSquare');
export const MoreVertical = symbol('more_vert', 'MoreVertical');
export const Pause = symbol('pause', 'Pause');
export const Pencil = symbol('edit', 'Pencil');
export const PencilLine = symbol('edit_note', 'PencilLine');
export const Play = symbol('play_arrow', 'Play');
export const PlayCircle = symbol('play_circle', 'PlayCircle');
export const Plug = symbol('power', 'Plug');
export const PlugZap = symbol('electrical_services', 'PlugZap');
export const Plus = symbol('add', 'Plus');
export const Presentation = symbol('co_present', 'Presentation');
export const QrCode = symbol('qr_code_2', 'QrCode');
export const RefreshCw = symbol('refresh', 'RefreshCw');
export const RotateCcw = symbol('restart_alt', 'RotateCcw');
export const Save = symbol('save', 'Save');
export const Search = symbol('search', 'Search');
export const Server = symbol('dns', 'Server');
export const Settings = symbol('settings', 'Settings');
export const ShieldCheck = symbol('verified_user', 'ShieldCheck');
export const Smartphone = symbol('smartphone', 'Smartphone');
export const Sparkles = symbol('auto_awesome', 'Sparkles');
export const Table2 = symbol('table', 'Table2');
export const Trash2 = symbol('delete', 'Trash2');
export const Unplug = symbol('power_off', 'Unplug');
export const Upload = symbol('upload', 'Upload');
export const User = symbol('person', 'User');
export const UserPlus = symbol('person_add', 'UserPlus');
export const Users = symbol('group', 'Users');
export const Wand2 = symbol('auto_fix_high', 'Wand2');
export const Webhook = symbol('webhook', 'Webhook');
export const Workflow = symbol('account_tree', 'Workflow');
export const X = symbol('close', 'X');
export const XCircle = symbol('cancel', 'XCircle');
