import React from "react";
import MenuRecipeManager from "../components/Inventory/MenuRecipeManager";

export default function MenuRecipeModulePage() {
  return (
    <div
      className="min-h-screen w-full max-w-full overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      style={{ background: "linear-gradient(180deg,#F4F8FF 0%,#F7FAFF 40%,#F4F8FF 100%)", color: "#0F1E3D" }}
    >
      <div className="w-full space-y-5 sm:space-y-6">
        <MenuRecipeManager />
      </div>
    </div>
  );
}
