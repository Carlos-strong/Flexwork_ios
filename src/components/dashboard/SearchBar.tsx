"use client";

import { Search, X } from "lucide-react";

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function SearchBar({ value, onChange, placeholder = "Rechercher une mission..." }: SearchBarProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-12 pl-11 pr-11 rounded-full bg-white border border-gray-100 shadow-[0_2px_12px_rgba(0,0,0,0.04)] text-[14px] placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#008751] focus:border-transparent transition-all"
        />
        {value && (
          <button onClick={() => onChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
