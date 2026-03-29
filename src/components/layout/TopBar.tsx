import { Search, Scan, Menu } from "lucide-react";
import NotificationCenter from "./NotificationCenter";

interface TopBarProps {
  onMenuClick: () => void;
}

const TopBar = ({ onMenuClick }: TopBarProps) => {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 backdrop-blur-xl px-4 lg:h-16 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search patrols, guards, incidents..."
            className="h-9 w-60 rounded-lg border border-border bg-muted/50 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary lg:w-80"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 lg:gap-3">
        <NotificationCenter />
        <button className="flex h-9 items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20 lg:px-3">
          <Scan className="h-4 w-4" />
          <span className="hidden sm:inline">NFC Scan</span>
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
          A
        </div>
      </div>
    </header>
  );
};

export default TopBar;
