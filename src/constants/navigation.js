import {
  LayoutDashboard,
  Users,
  Search,
  Bot,
  Link2,
  MessageSquare,
  Heart,
  Globe,
  HardDrive,
  Settings,
} from "lucide-react";

export const NAV_ITEMS = [
  { id: "dashboard", icon: LayoutDashboard, label: "Обзор" },
  { id: "accounts", icon: Users, label: "Аккаунты" },
  { id: "parsing", icon: Search, label: "Парсинг" },
  { id: "bot_parsing", icon: Bot, label: "Парсинг ботом" },
  { id: "bot_invites", icon: Link2, label: "Ссылки бота" },
  { id: "mailing", icon: MessageSquare, label: "Рассылка" },
  { id: "reactions", icon: Heart, label: "Реакции" },
  { id: "proxy", icon: Globe, label: "Прокси" },
  { id: "database", icon: HardDrive, label: "База данных" },
];

export const FOOTER_ITEMS = [{ id: "settings", icon: Settings, label: "Настройки" }];

export const TAB_TITLES = {
  dashboard: "Панель управления",
  accounts: "Менеджер аккаунтов",
  settings: "Конфигурация системы",
  parsing: "Парсинг аудитории",
  bot_parsing: "Парсинг через бота-админа",
  bot_invites: "Ссылки канала и вступления",
  mailing: "Массовая рассылка",
  reactions: "Реакции в чате",
  proxy: "Управление прокси",
  database: "База данных",
};
