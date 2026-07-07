export const roundMoney = (value: number) => {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
};

const getComponentAmount = ({
  component,
  savedAmount,
  basicAmount,
  grossBase,
}: {
  component: any;
  savedAmount?: number | null;
  basicAmount: number;
  grossBase: number;
}) => {
  // ✅ If employee-specific amount exists, use that first
  if (savedAmount !== null && savedAmount !== undefined) {
    return roundMoney(savedAmount);
  }

  const value = Number(component.value || 0);

  // ✅ Master calculation: Fixed amount
  if (component.calculationType === "FLAT") {
    return roundMoney(value);
  }

  // ✅ Master calculation: % of Basic
  if (component.calculationType === "%_BASIC") {
    return roundMoney((basicAmount * value) / 100);
  }

  // ✅ Master calculation: % of Gross
  if (component.calculationType === "%_GROSS") {
    return roundMoney((grossBase * value) / 100);
  }

  return 0;
};

export const calculatePayrollFromComponents = (salaryComponents: any[]) => {
  // ✅ Find basic pay component
  const basicComponent = salaryComponents.find((item) => {
    const name = String(item.component?.name || "").toLowerCase();

    return (
      item.component?.isWageCodeComponent === true ||
      name.includes("basic")
    );
  });

  const basicAmount = basicComponent
    ? getComponentAmount({
        component: basicComponent.component,
        savedAmount: basicComponent.amount,
        basicAmount: 0,
        grossBase: 0,
      })
    : 0;

  // ✅ First calculate flat earnings only
  const grossBase = salaryComponents
    .filter((item) => item.component?.type === "EARNING")
    .filter((item) => item.component?.calculationType === "FLAT")
    .reduce((sum, item) => {
      return (
        sum +
        getComponentAmount({
          component: item.component,
          savedAmount: item.amount,
          basicAmount,
          grossBase: 0,
        })
      );
    }, 0);

  const earnings = salaryComponents
    .filter((item) => item.component?.type === "EARNING")
    .map((item) => ({
      componentId: item.componentId,
      name: item.component.name,
      type: item.component.type,
      calculationType: item.component.calculationType,
      value: item.component.value,
      amount: getComponentAmount({
        component: item.component,
        savedAmount: item.amount,
        basicAmount,
        grossBase,
      }),
    }));

  const deductions = salaryComponents
    .filter((item) => item.component?.type === "DEDUCTION")
    .map((item) => ({
      componentId: item.componentId,
      name: item.component.name,
      type: item.component.type,
      calculationType: item.component.calculationType,
      value: item.component.value,
      amount: getComponentAmount({
        component: item.component,
        savedAmount: item.amount,
        basicAmount,
        grossBase,
      }),
    }));

  const reimbursements = salaryComponents
    .filter((item) => item.component?.type === "REIMBURSEMENT")
    .map((item) => ({
      componentId: item.componentId,
      name: item.component.name,
      type: item.component.type,
      calculationType: item.component.calculationType,
      value: item.component.value,
      amount: getComponentAmount({
        component: item.component,
        savedAmount: item.amount,
        basicAmount,
        grossBase,
      }),
    }));

  const grossEarnings = roundMoney(
    earnings.reduce((sum, item) => sum + item.amount, 0)
  );

  const totalDeductions = roundMoney(
    deductions.reduce((sum, item) => sum + item.amount, 0)
  );

  const totalReimbursements = roundMoney(
    reimbursements.reduce((sum, item) => sum + item.amount, 0)
  );

  const netPay = roundMoney(
    grossEarnings + totalReimbursements - totalDeductions
  );

  return {
    earnings,
    deductions,
    reimbursements,
    grossEarnings,
    totalDeductions,
    totalReimbursements,
    netPay,
  };
};