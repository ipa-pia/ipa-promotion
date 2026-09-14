import "@imengyu/vue3-context-menu/lib/vue3-context-menu.css";
import ContextMenu, { type MenuOptions } from "@imengyu/vue3-context-menu";

export { ContextMenu };

export const useContextMenu = (
  e: MouseEvent,
  opts?: Partial<MenuOptions> & Required<Pick<MenuOptions, "items">>
) => {
  e.preventDefault();
  return ContextMenu.showContextMenu({
    theme: "mac dark",
    ...opts,
    x: e.clientX,
    y: e.clientY,
  });
};
