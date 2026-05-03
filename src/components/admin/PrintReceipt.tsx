import React from 'react';

interface PrintReceiptProps {
  order: any;
  storeInfo: any;
  isKitchen?: boolean;
}

export const PrintReceipt = React.forwardRef<HTMLDivElement, PrintReceiptProps>(({ order, storeInfo, isKitchen }, ref) => {
  if (!order) return null;

  return (
    <div ref={ref} className="hidden print:block bg-white text-black p-4 text-[12px] font-mono leading-tight max-w-[300px] mx-auto">
      {/* Cabeçalho */}
      <div className="text-center mb-4 border-b border-black border-dashed pb-4">
        <h1 className="font-bold text-lg uppercase">
          {isKitchen ? '*** PRODUÇÃO COZINHA ***' : (storeInfo?.general?.name || storeInfo?.storeName || 'Loja')}
        </h1>
        {!isKitchen && <p>Pedido: #{order.id?.substring(0, 5)} ({order.id})</p>}
        <p>Data: {new Date(order.orderDateTime || Date.now()).toLocaleDateString('pt-BR')} {new Date(order.orderDateTime || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
        {!['delivered', 'canceled', 'completed', 'awaiting_payment'].includes(order.status) && order.orderType === 'delivery' && (
          <p>Previsão: {new Date(new Date(order.orderDateTime || Date.now()).getTime() + 50 * 60000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
        )}
      </div>

      {/* Tipo de Pedido */}
      <div className="text-center font-bold mb-4 uppercase">
        {order.orderType === 'pickup' ? '*** RETIRADA NO LOCAL ***' : 
         order.orderType === 'dine_in' ? '*** COMER NO LOCAL ***' : 
         '*** ENTREGA ***'}
      </div>

      {/* Dados do Cliente */}
      <div className="mb-4 border-b border-black border-dashed pb-4">
        <p className="font-bold uppercase mb-1">Dados do Cliente</p>
        <p>Nome: {order.customerName}</p>
        <p>Celular: {order.customerPhone}</p>
        {order.deliveryAddress && (
          <p>Endereço: {order.deliveryAddress}</p>
        )}
      </div>

      {/* Itens */}
      <div className="mb-4 border-b border-black border-dashed pb-4">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-black">
              <th className="w-8 py-1 font-bold">Qtd</th>
              <th className="py-1 font-bold">Item</th>
              {!isKitchen && <th className="w-16 py-1 text-right font-bold">Valor</th>}
            </tr>
          </thead>
          <tbody>
            {(order.items || []).map((item: any, idx: number) => (
              <React.Fragment key={idx}>
                <tr>
                  <td className="py-1 align-top">{item.quantity}</td>
                  <td className="py-1">
                    <div className="font-bold text-sm">{item.name}</div>
                    {item.addons?.map((addon: any, aidx: number) => (
                      <div key={aidx} className="text-[10px] pl-2 whitespace-nowrap overflow-hidden text-ellipsis">
                        &gt; {addon.name} {!isKitchen && addon.price ? `(+R$ ${addon.price.toFixed(2)})` : ''}
                      </div>
                    ))}
                    {item.notes && (
                      <div className="text-[12px] font-bold pl-2 italic overflow-hidden text-ellipsis">
                        Obs: {item.notes}
                      </div>
                    )}
                  </td>
                  {!isKitchen && (
                    <td className="py-1 text-right align-top whitespace-nowrap">
                      R$ {((item.unitPrice || 0) * item.quantity).toFixed(2)}
                    </td>
                  )}
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totais e Pagamento */}
      {!isKitchen && (() => {
        let paymentText = order.paymentMethod || 'Pagamento na Entrega/Retirada';
        let changeFor = 0;
        let changeAmount = 0;

        const trocoMatch = paymentText.match(/Troco para R\$\s*([\d.,]+)/i);
        if (trocoMatch) {
          const val = parseFloat(trocoMatch[1].replace(',', '.'));
          if (!isNaN(val)) {
            changeFor = val;
            changeAmount = val - (order.totalAmount || 0);
            paymentText = paymentText.replace(/\s*\(Troco para.*?\)/i, '').trim();
          }
        }

        return (
          <>
            <div className="mb-4 space-y-1">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>R$ {order.items?.reduce((acc: number, item: any) => acc + ((item.unitPrice || 0) * item.quantity), 0).toFixed(2) || '0.00'}</span>
              </div>
              {order.orderType === 'delivery' && (
                <div className="flex justify-between">
                  <span>Taxa de entrega</span>
                  <span>{order.deliveryFee > 0 ? `R$ ${order.deliveryFee.toFixed(2)}` : 'Grátis'}</span>
                </div>
              )}
              
              <div className="border-t border-black border-dashed mt-2 pt-2">
                <div className="flex justify-between font-bold text-sm uppercase">
                  <span>TOTAL</span>
                  <span>R$ {(order.totalAmount || 0).toFixed(2)}</span>
                </div>
              </div>

              {changeFor > 0 && changeAmount > 0 && (
                <div className="mt-4 space-y-1 uppercase font-bold text-[14px]">
                  <div className="flex justify-between">
                    <span>PAGAMENTO</span>
                    <span>R$ {changeFor.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>TROCO</span>
                    <span>R$ {changeAmount.toFixed(2)}</span>
                  </div>
                </div>
              )}

              <div className="mt-4 uppercase text-sm border-b border-black border-dashed pb-4">
                <p>Forma: {paymentText}</p>
              </div>
            </div>

            <div className="mt-8 text-center text-[10px]">
              <p>Obrigado pela preferência!</p>
              <p>{storeInfo?.general?.name || storeInfo?.storeName || 'Loja'}</p>
            </div>
          </>
        );
      })()}
    </div>
  );
});

PrintReceipt.displayName = 'PrintReceipt';
