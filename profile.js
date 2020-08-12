// index.js
const Promise = require('bluebird')
const AppDAO = require('./dao')
const ArDriveDB = require('./ardrive_db')
const ArDriveCrypto = require('./crypto')
const fs = require('fs');
const prompt = require('prompt-sync')({sigint: true});
const passwordPrompt = require("prompts")


// SQLite Database Setup
const arDriveDBFile = "C:\\ArDrive\\ardrive.db"
const dao = new AppDAO(arDriveDBFile)
const arDriveFiles = new ArDriveDB(dao)

// Establish Arweave node connectivity.
const gatewayURL = "https://arweave.net/"
const Arweave = require('arweave/node');
const arweave = Arweave.init({
    //host: 'perma.online', // ARCA Community Gateway
    host: 'arweave.net', // Arweave Gateway
    port: 443,
    protocol: 'https',
    timeout: 600000
});

// Load ArDrive PST Smart Contract
const contractId = '4JDU_Ha3bMeFtDMy1HgKSB3UsmPbW_VCCLIp7Vi0rLE'


// First Time Setup
exports.arDriveProfileSetup = async function() {
  return new Promise(async (resolve, reject) => {
      try {
          // Welcome message and info
          console.log ("We have not detected a profile.  To store your files permanently, you must first setup your ArDrive account.")

          // Get the ArDrive owner nickname
          console.log ("What is the nickname you would like to give to this wallet?")
          const owner = prompt ('Please enter your nickname: ')

          // Setup ArDrive Login Password
          console.log ('Your ArDrive Login password will be used to unlock your ArDrive and start syncing.');
          //const password = prompt('Please enter a strong ArDrive Login password: ');
          const loginPasswordResponse = await passwordPrompt({
              type: 'text',
              name: 'password',
              style: 'password',
              message: 'Please enter a strong ArDrive Login password: '
          });

          // Setup ArDrive Data Protection Password
          console.log ('Your ArDrive Data Protection password will be used to encrypt your data on the Permaweb.  Do NOT lose this!!!');
          var dataProtectionKeyResponse = await passwordPrompt({
              type: 'text',
              name: 'password',
              style: 'password',
              message: 'Please enter a strong ArDrive Encryption password: '
          });
          //const dataProtectionKey = prompt('Please enter a strong ArDrive Encryption password: ');

          // Create new or import Arweave wallet
          console.log ("To use ArDrive, you must have an Arweave Wallet.")
          const existingWallet = prompt('Do you have an existing Arweave Wallet (.json file) Y/N ');
          if (existingWallet == "Y") {
              console.log ("Please enter the path of your existing Arweave Wallet JSON file eg. C:\\Source\\ardrive_test_key.json")
              const existingWalletPath = prompt ("Wallet Path: ")
              var wallet_private_key = JSON.parse(fs.readFileSync(existingWalletPath).toString());
          }
          else if (existingWallet == "N")
          {
              // Create Wallet
              var wallet_private_key = await createArDriveWallet()
          }

          const wallet_public_key = await arweave.wallets.jwkToAddress(wallet_private_key)
          const encrypted_wallet_private_key = await ArDriveCrypto.encryptText(JSON.stringify(wallet_private_key), loginPasswordResponse.password)
          const encrypted_dataProtectionKey = await ArDriveCrypto.encryptText(dataProtectionKeyResponse.password, loginPasswordResponse.password)

          // Set sync schedule
          const sync_schedule = "1 minute"
          // 5 minutes, 15 mintues, 30 minutes, 60 minutes

          // Setup ArDrive folder location
          const syncFolderPath = await setupArDriveSyncFolder()

          // Save to Database
          var profileToAdd = {
              owner: owner,
              sync_schedule: sync_schedule,
              data_protection_key: JSON.stringify(encrypted_dataProtectionKey),
              wallet_private_key: JSON.stringify(encrypted_wallet_private_key),
              wallet_public_key: wallet_public_key,
              sync_schedule: sync_schedule,
              sync_folder_path: syncFolderPath
          }
          await arDriveFiles.createArDriveProfile(profileToAdd)
          resolve ({password: dataProtectionKeyResponse.password, jwk: JSON.stringify(wallet_private_key), wallet_public_key: wallet_public_key, owner: owner, sync_folder_path: syncFolderPath})
      }
      catch (err)
      {
          console.log(err)
          reject ("Error creating new ArDrive")
      }
  })
}

// Decrypts password
exports.unlockArDriveProfile = async function (wallet_public_key, owner) {
  return new Promise(async (resolve, reject) => {
      try {
          console.log ("An ArDrive Wallet is present for: %s", owner)
          const response = await passwordPrompt({
              type: 'text',
              name: 'password',
              style: 'password',
              message: 'Please enter your ArDrive password for this wallet: '
          });
  
          const profile = await arDriveFiles.getAll_fromProfile(wallet_public_key)
          const jwk = await ArDriveCrypto.decryptText(JSON.parse(profile[0].wallet_private_key), response.password)
          const dataProtectionKey = await ArDriveCrypto.decryptText(JSON.parse(profile[0].data_protection_key), response.password)
          console.log ("")
          console.log ("ArDrive unlocked!!")
          console.log ("")
          resolve ({password: dataProtectionKey, jwk: jwk, wallet_public_key: wallet_public_key, owner: profile[0].owner, sync_folder_path: profile[0].sync_folder_path})
      }
      catch (err) {
          //console.log (err)
          reject ("Incorrect Password!! Cannot unlock ArDrive")
      }
  })
}

async function setupArDriveSyncFolder () {
  return new Promise(async (resolve, reject) => {
      try {
          console.log ("Please enter the path of your local ArDrive folder e.g D:\\ArDriveSync.  A new folder will be created if it does not exist")
          var syncFolderPath = prompt ("ArDrive Sync Folder Path: ")
          var stats = fs.statSync(syncFolderPath)
          if (stats.isDirectory())
          {
              if (!fs.existsSync(syncFolderPath.concat("\\Public"))){
                  fs.mkdirSync(syncFolderPath.concat("\\Public"));
              }
              console.log ("Using %s as the local ArDrive folder.", syncFolderPath)
              resolve (syncFolderPath)
          }
          else {
              console.log ("The path you have entered is not a directory, please enter a correct path for ArDrive.")
              resolve (setupArDriveSyncFolder())
          }
      }
      catch {
          try {
              console.log ("Directory not found.  Creating.")
              fs.mkdirSync(syncFolderPath);
              fs.mkdirSync(syncFolderPath.concat("\\Public"));
              resolve (syncFolderPath)
          }
          catch (err) {
              //console.log (err)
              console.log ("The path you have entered is not a directory, please enter a correct path for ArDrive.")
              resolve (setupArDriveSyncFolder())
          }
      }
  })
}

// Create a wallet and save to DB
async function createArDriveWallet() {
  return new Promise(async (resolve, reject) => {
      try {
          const myNewKey = await arweave.wallets.generate()
          const myNewWalletAddress = await arweave.wallets.jwkToAddress(myNewKey)
          console.log ("SUCCESS! Your new wallet public address is %s", myNewWalletAddress.toString())
          resolve (myNewKey)
      }
      catch {
          reject ("Cannot create a new Wallet")
      }
  })
}

// TO DO
// Create an ArDrive password and save to DB
exports.resetArDrivePassword = async function () {
}