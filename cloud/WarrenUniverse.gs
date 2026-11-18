// Each consumer gets its own list. The declaration also works across Apps Script files.
function warrenUniverse() {
  return [
    ['06823','香港电讯','core','telecom'],['00220','统一企业中国','core','consumer'],
    ['00288','万洲国际','core','consumer'],['00014','希慎兴业','core','property'],
    ['00823','领展房产基金','core','reit'],['01052','越秀交通基建','core','toll'],
    ['02638','港灯电力投资','core','utility'],['00941','中国移动','watch','telecom'],
    ['00883','中国海洋石油','watch','energy'],['00939','建设银行','watch','bank'],
    ['00003','香港中华煤气','watch','utility'],['00177','江苏宁沪高速','watch','toll'],
    ['03877','中国船舶租赁','watch','shipping'],['00696','中国民航信息网络','watch','travel'],
    ['03416','Global X国指备兑认购期权主动ETF','etf','fund'],['03417','Global X恒生科技备兑认购期权主动ETF','etf','fund']
  ].map(function (row) {
    return {symbol:'HK.' + row[0], name:row[1], group:row[2], sector:row[3]};
  });
}
