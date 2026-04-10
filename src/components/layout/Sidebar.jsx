import React from "react";
import { Send } from "lucide-react";
import SidebarItem from "./SidebarItem";
import { FOOTER_ITEMS, NAV_ITEMS } from "../../constants/navigation";

const Sidebar = ({ activeTab, setActiveTab }) => (
  <aside className="w-64 bg-gray-950 border-r border-gray-800 flex flex-col p-4 fixed h-full z-10">
    <div className="flex items-center space-x-3 px-4 mb-10 mt-2">
      <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
        <Send className="text-white transform -rotate-12" size={24} />
      </div>
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight leading-none uppercase">TG-Master</h1>
        <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">Enterprise v2.5</span>
      </div>
    </div>

    <nav className="flex-1 space-y-1">
      {NAV_ITEMS.map((item) => (
        <SidebarItem key={item.id} {...item} activeTab={activeTab} onChange={setActiveTab} />
      ))}
    </nav>

    <div className="mt-auto space-y-1 border-t border-gray-800 pt-4">
      {FOOTER_ITEMS.map((item) => (
        <SidebarItem key={item.id} {...item} activeTab={activeTab} onChange={setActiveTab} />
      ))}
    </div>
  </aside>
);

export default Sidebar;
