const env = require('dotenv').config(),
  cuapClient = require('./cuap/cuap');

const terminalWidth = (process.stdout.columns || defaultColumns)

// Create TCP Session with Server
const session = new cuapClient.Session({ host: process.env.CUAP_SESSION_URL, port: process.env.CUAP_SESSION_PORT });

// Log Sent PDUs
session.on('send', (pdu) => {
  console.log(`\n\nSent: ${pdu.command.toUpperCase()} `.padEnd(terminalWidth, '*'))
  console.log(pdu)
})

//Log Recieved PDUs
session.on('pdu', (pdu) => {
  console.log(`\n\nRecieved: ${pdu.command.toUpperCase()} `.padEnd(terminalWidth, '*'))
  console.log(pdu)
})

//Log Recieved Errors
session.on('error', (e) => {
  // console.log(session)
  // console.log(`\n\nError:`.padEnd(terminalWidth, '*'))
  console.log(e)
})

//Session Events*********************************************
//Bind_Resp
session.on('bind_resp', (pdu) => {
  if (pdu.command_status) {
    // console.log("Bind Success!")
    session.shake()
  }
  // else {
  //   console.log(`\n\nError binding to server`, `\nClosing Session`.padEnd(terminalWidth, '*'))
  //   session.close(() => console.log('Closed'))
  // }
})

//Initial Session Conection
session.on('connect', () => {
  session.bind({
    system_id: process.env.CUAP_SYSTEM_ID,
    password: process.env.CUAP_SYSTEM_PWD,
    system_type: process.env.CUAP_SYSTEM_TYPE,
    interface_version: 0x00000010
  })
})


session.socket.on("data", data => {
  console.log(data);
});