import {
  AlignLeft,
  Book,
  Box,
  Castle,
  Crown,
  Flag,
  Flame,
  Gem,
  Ghost,
  Hash,
  Heart,
  Key,
  Leaf,
  Link2,
  List,
  MapPin,
  Package,
  Palette,
  Scroll,
  Shield,
  Skull,
  Sparkles,
  Star,
  Sword,
  ToggleLeft,
  Type,
  User,
  Users,
  type LucideIcon
} from 'lucide-react'
import type { PropertyType } from '@shared/schema'

/** Icons a template can use. Keys are what's stored in the project file. */
export const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  box: Box,
  user: User,
  users: Users,
  sword: Sword,
  shield: Shield,
  scroll: Scroll,
  book: Book,
  'map-pin': MapPin,
  castle: Castle,
  gem: Gem,
  key: Key,
  package: Package,
  flag: Flag,
  star: Star,
  heart: Heart,
  crown: Crown,
  skull: Skull,
  ghost: Ghost,
  flame: Flame,
  leaf: Leaf,
  sparkles: Sparkles
}

export function templateIcon(key: string | undefined): LucideIcon {
  return (key && TEMPLATE_ICONS[key]) || Box
}

export const PROPERTY_TYPE_META: Record<PropertyType, { label: string; icon: LucideIcon; hint: string }> = {
  text: { label: 'Text', icon: Type, hint: 'A single line, like a title or a short name' },
  longText: { label: 'Long text', icon: AlignLeft, hint: 'Paragraphs: biographies, notes, descriptions' },
  number: { label: 'Number', icon: Hash, hint: 'Age, weight, price, with optional limits' },
  boolean: { label: 'Yes / no', icon: ToggleLeft, hint: 'A flag such as "Is alive"' },
  enum: { label: 'Choice', icon: List, hint: 'One option from a list you define' },
  reference: { label: 'Entity link', icon: Link2, hint: 'Points at another entity, e.g. a faction' },
  color: { label: 'Colour', icon: Palette, hint: 'A colour swatch' }
}
