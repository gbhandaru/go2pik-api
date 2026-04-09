// Placeholder automation stub that mimics placing an order through a third-party workflow.
async function runOrderAutomation(orderDetails) {
  try {
    console.log('[automation] Dispatching order for', orderDetails.restaurant.name);
    orderDetails.items.forEach((item) => {
      console.log(`  -> ${item.quantity} x ${item.name} @ ${item.price}`);
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      message: 'Automation stub complete',
      confirmationNumber: `GO-${Date.now()}`,
    };
  } catch (error) {
    console.error('[automation] Failed:', error);
    throw error;
  }
}

module.exports = { runOrderAutomation };
