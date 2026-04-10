import React from "react";
import { TAB_TITLES } from "../../constants/navigation";

const Header = ({ activeTab }) => (
  <header className="flex justify-between items-center mb-8">
    <div className="animate-in slide-in-from-left duration-500">
      <h2 className="text-2xl font-bold text-white tracking-tight">{TAB_TITLES[activeTab] || "Раздел"}</h2>
    </div>
  </header>
);

export default Header;
