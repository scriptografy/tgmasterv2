import React from "react";

const SidebarItem = ({ id, icon: Icon, label, activeTab, onChange }) => (
  <button
    onClick={() => onChange(id)}
    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
      activeTab === id
        ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20"
        : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
    }`}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </button>
);

export default SidebarItem;
