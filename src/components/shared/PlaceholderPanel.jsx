import React from "react";
import { Filter } from "lucide-react";

const PlaceholderPanel = ({ text, subtle = false }) => (
  <div
    className={`flex flex-col items-center justify-center h-[500px] bg-gray-900/30 border-2 border-dashed border-gray-800 rounded-3xl ${
      subtle ? "opacity-50" : "opacity-70"
    }`}
  >
    <Filter className="text-gray-600 mb-4" size={48} />
    <p className="text-gray-400">{text}</p>
  </div>
);

export default PlaceholderPanel;
